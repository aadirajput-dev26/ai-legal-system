import { FastifyRequest, FastifyReply } from 'fastify';
import { billingConfig, microToPaise, fromMicro } from '../lib/billing-config.js';
import { CreditService } from '../services/credit.service.js';
import { RazorpayService } from '../services/razorpay.service.js';
import { BillingRepository, type OrgMembership } from '../repositories/billing.repository.js';

/**
 * billing.controller.ts
 *
 * TWO RULES GOVERN THIS FILE
 *
 * 1. The frontend never grants anything. Checkout success is a UI event only.
 *    Entitlement changes come from a signature-verified webhook, or from a
 *    server-side re-fetch of the payment from Razorpay. Never from the browser.
 *
 * 2. Every write names its organisation explicitly. There is no "pick one for
 *    them" fallback: a user who is an admin of two firms must never have a
 *    subscription or a top-up silently applied to the wrong one.
 */

const ok = (reply: FastifyReply, data: any) => reply.send({ success: true, data });
const fail = (reply: FastifyReply, code: number, errCode: string, message: string, extra: any = {}) =>
    reply.status(code).send({ success: false, error: { code: errCode, message, ...extra } });

const userId = (req: FastifyRequest) => (req.user as any)?.userId as string;

type Resolved =
    | { ok: true; org: OrgMembership }
    | { ok: false; status: number; code: string; message: string; extra?: any };

/**
 * Resolve which organisation this request is about.
 *
 * `required` (writes): the caller MUST name the organisation.
 * Otherwise (reads): omitting it is allowed only when the user belongs to
 * exactly one organisation. With two or more we refuse and return the list so
 * the UI can ask, rather than guessing.
 */
async function resolveOrg(
    req: FastifyRequest,
    opts: { required: boolean },
): Promise<Resolved> {
    const uid = userId(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const query = (req.query ?? {}) as Record<string, unknown>;
    const given = (body.organisationId ?? query.organisationId) as string | undefined;

    if (opts.required && !given) {
        const memberships = await BillingRepository.listMemberships(uid);
        return {
            ok: false, status: 400, code: 'ORGANISATION_REQUIRED',
            message: 'organisationId is required for this operation.',
            extra: { organisations: memberships.map(m => ({ id: m.id, name: m.name, role: m.role })) },
        };
    }

    if (given) {
        const m = await BillingRepository.getMembership(uid, given);
        if (!m) {
            return {
                ok: false, status: 403, code: 'NOT_A_MEMBER',
                message: 'You do not belong to that organisation.',
            };
        }
        return { ok: true, org: m };
    }

    const memberships = await BillingRepository.listMemberships(uid);
    if (memberships.length === 0) {
        return {
            ok: false, status: 404, code: 'NO_ORGANISATION',
            message: 'You do not belong to an organisation yet.',
        };
    }
    if (memberships.length > 1) {
        return {
            ok: false, status: 400, code: 'ORGANISATION_REQUIRED',
            message: 'You belong to more than one organisation. Say which one.',
            extra: { organisations: memberships.map(m => ({ id: m.id, name: m.name, role: m.role })) },
        };
    }
    return { ok: true, org: memberships[0] };
}

// ── GET /billing/me ──────────────────────────────────────────────────
export const getBilling = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
        const r = await resolveOrg(req, { required: false });
        if (!r.ok) return fail(reply, r.status, r.code, r.message, r.extra);
        const org = r.org;

        const [summary, plans, packs, breakdown, memberships] = await Promise.all([
            CreditService.summary(org.id),
            BillingRepository.listPlans(),
            BillingRepository.listPacks(),
            CreditService.breakdown(org.id),
            BillingRepository.listMemberships(userId(req)),
        ]);

        return ok(reply, {
            organisation: { id: org.id, name: org.name, role: org.role },
            organisations: memberships.map(m => ({ id: m.id, name: m.name, role: m.role })),
            creditLabel: billingConfig.creditLabel,
            enforcementEnabled: billingConfig.enforcementEnabled,
            minBalanceCredits: billingConfig.minBalanceCredits,
            razorpayKeyId: RazorpayService.publicKeyId || null,
            razorpayConfigured: RazorpayService.configured,
            balance: summary,
            plans: plans.map(p => ({
                code: p.code, name: p.name, description: p.description,
                priceInr: fromMicro(p.price_micro), includedCredits: Number(p.included_credits),
                seatLimit: p.seat_limit, ready: Boolean(p.razorpay_plan_id),
            })),
            packs: packs.map(p => ({
                code: p.code, name: p.name,
                priceInr: fromMicro(p.price_micro), credits: Number(p.credits),
            })),
            breakdown,
        });
    } catch (err: any) {
        req.log.error(err);
        return fail(reply, 500, 'BILLING_ERROR', err.message);
    }
};

// ── GET /billing/statement ───────────────────────────────────────────
export const getStatement = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
        const r = await resolveOrg(req, { required: false });
        if (!r.ok) return fail(reply, r.status, r.code, r.message, r.extra);
        const limit = Number((req.query as any)?.limit) || 50;
        return ok(reply, { entries: await CreditService.statement(r.org.id, limit) });
    } catch (err: any) {
        req.log.error(err);
        return fail(reply, 500, 'BILLING_ERROR', err.message);
    }
};

// ── POST /billing/subscribe ──────────────────────────────────────────
// Creates a Razorpay subscription and returns what Checkout needs.
// Grants NOTHING. Credits arrive via subscription.charged.
export const subscribe = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
        const r = await resolveOrg(req, { required: true });
        if (!r.ok) return fail(reply, r.status, r.code, r.message, r.extra);
        const org = r.org;
        if (!org.isAdmin) return fail(reply, 403, 'FORBIDDEN', 'Only an organisation administrator can change the plan.');
        if (!RazorpayService.configured) return fail(reply, 503, 'RAZORPAY_NOT_CONFIGURED', 'Payments are not enabled on this server yet.');

        const { planCode } = (req.body as any) || {};
        const plan = await BillingRepository.findPlanByCode(planCode || 'PRO');
        if (!plan) return fail(reply, 404, 'PLAN_NOT_FOUND', 'That plan does not exist.');

        // Lazily create the Razorpay plan the first time it is needed.
        let razorpayPlanId = plan.razorpay_plan_id;
        if (!razorpayPlanId) {
            const created = await RazorpayService.createPlan({
                amountPaise: microToPaise(plan.price_micro),
                name: plan.name,
                description: plan.description ?? undefined,
            });
            razorpayPlanId = created.id;
            await BillingRepository.setRazorpayPlanId(plan.id, razorpayPlanId!);
        }

        const sub = await RazorpayService.createSubscription({
            planId: razorpayPlanId!,
            notes: { organisation_id: org.id, plan_code: plan.code, created_by: userId(req) },
        });

        await BillingRepository.upsertSubscription({
            organisationId: org.id,
            planId: plan.id,
            razorpaySubscriptionId: sub.id,
            status: sub.status || 'created',
            createdBy: userId(req),
        });

        return ok(reply, {
            subscriptionId: sub.id,
            razorpayKeyId: RazorpayService.publicKeyId,
            planName: plan.name,
            amountInr: fromMicro(plan.price_micro),
            includedCredits: Number(plan.included_credits),
        });
    } catch (err: any) {
        req.log.error(err);
        return fail(reply, 502, 'RAZORPAY_ERROR', err.message);
    }
};

// ── POST /billing/topup ──────────────────────────────────────────────
export const createTopUp = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
        const r = await resolveOrg(req, { required: true });
        if (!r.ok) return fail(reply, r.status, r.code, r.message, r.extra);
        const org = r.org;
        if (!org.isAdmin) return fail(reply, 403, 'FORBIDDEN', 'Only an organisation administrator can buy credits.');
        if (!RazorpayService.configured) return fail(reply, 503, 'RAZORPAY_NOT_CONFIGURED', 'Payments are not enabled on this server yet.');

        const { packCode } = (req.body as any) || {};
        const pack = await BillingRepository.findPackByCode(packCode);
        if (!pack) return fail(reply, 404, 'PACK_NOT_FOUND', 'That top-up option does not exist.');

        const paymentRow = await BillingRepository.createTopUpPayment({
            organisationId: org.id,
            packId: pack.id,
            amountMicro: pack.price_micro,
            createdBy: userId(req),
        });

        const order = await RazorpayService.createOrder({
            amountPaise: microToPaise(pack.price_micro),
            receipt: `topup_${paymentRow}`.slice(0, 40),
            notes: { organisation_id: org.id, pack_code: pack.code, payment_row: paymentRow },
        });

        await BillingRepository.attachOrderId(paymentRow, order.id);

        return ok(reply, {
            orderId: order.id,
            razorpayKeyId: RazorpayService.publicKeyId,
            amountInr: fromMicro(pack.price_micro),
            credits: Number(pack.credits),
            packName: pack.name,
        });
    } catch (err: any) {
        req.log.error(err);
        return fail(reply, 502, 'RAZORPAY_ERROR', err.message);
    }
};

// ── POST /billing/topup/confirm ──────────────────────────────────────
// Called by the browser after Checkout. We verify the signature AND re-fetch
// the payment from Razorpay before granting anything. The webhook grants the
// same credits idempotently, so whichever arrives first wins.
export const confirmTopUp = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
        const r = await resolveOrg(req, { required: true });
        if (!r.ok) return fail(reply, r.status, r.code, r.message, r.extra);

        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = (req.body as any) || {};
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return fail(reply, 400, 'MISSING_FIELDS', 'Payment details are incomplete.');
        }

        const valid = RazorpayService.verifyOrderSignature({
            orderId: razorpay_order_id, paymentId: razorpay_payment_id, signature: razorpay_signature,
        });
        if (!valid) return fail(reply, 400, 'BAD_SIGNATURE', 'This payment could not be verified.');

        const payment = await RazorpayService.getPayment(razorpay_payment_id);
        if (payment.status !== 'captured') {
            return fail(reply, 409, 'NOT_CAPTURED', `Payment is ${payment.status}, not captured yet.`);
        }

        // The order must belong to the organisation the caller named.
        const row = await BillingRepository.findTopUpByOrderId(payment.order_id);
        if (!row) return fail(reply, 404, 'ORDER_NOT_FOUND', 'No matching top-up was found for this payment.');
        if (row.organisation_id !== r.org.id) {
            return fail(reply, 403, 'ORGANISATION_MISMATCH', 'That payment belongs to a different organisation.');
        }

        await applyTopUpPayment(payment);
        return ok(reply, { balance: await CreditService.summary(r.org.id) });
    } catch (err: any) {
        req.log.error(err);
        return fail(reply, 502, 'RAZORPAY_ERROR', err.message);
    }
};

/** Shared by the confirm route and the webhook. Idempotent both ways. */
async function applyTopUpPayment(payment: any): Promise<void> {
    const p = await BillingRepository.findTopUpByOrderId(payment.order_id);
    if (!p) {
        console.error('[billing] captured top-up with no matching payment row', payment.order_id);
        return;
    }

    await BillingRepository.captureTopUpPayment({
        paymentId: p.id,
        razorpayPaymentId: payment.id,
        method: payment.method ?? null,
        credits: Number(p.credits),
        raw: payment,
    });

    await CreditService.grantTopUp({
        organisationId: p.organisation_id,
        credits: Number(p.credits),
        paymentId: p.id,
        razorpayPaymentId: payment.id,
    });
}

// ── POST /billing/cancel ─────────────────────────────────────────────
export const cancelSubscription = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
        const r = await resolveOrg(req, { required: true });
        if (!r.ok) return fail(reply, r.status, r.code, r.message, r.extra);
        if (!r.org.isAdmin) return fail(reply, 403, 'FORBIDDEN', 'Only an organisation administrator can cancel the plan.');

        const sub = await BillingRepository.findLiveSubscription(r.org.id);
        if (!sub) return fail(reply, 404, 'NO_SUBSCRIPTION', 'There is no active subscription to cancel.');

        await RazorpayService.cancelSubscription(sub.razorpay_subscription_id, true);
        await BillingRepository.markCancelAtPeriodEnd(sub.razorpay_subscription_id);
        return ok(reply, { cancelAtPeriodEnd: true });
    } catch (err: any) {
        req.log.error(err);
        return fail(reply, 502, 'RAZORPAY_ERROR', err.message);
    }
};

// ── POST /webhooks/razorpay ──────────────────────────────────────────
// Public. Signature-verified. Claim-then-process, so a delivery interrupted by
// a hard kill is re-processed on Razorpay's retry rather than deduplicated away.
export const razorpayWebhook = async (req: FastifyRequest, reply: FastifyReply) => {
    const signature = req.headers['x-razorpay-signature'] as string;
    const eventId = (req.headers['x-razorpay-event-id'] as string) || '';
    const raw = (req as any).rawBody as string | undefined;

    if (!raw) {
        req.log.error('[billing] webhook received without a raw body — check the app.ts content-type parser');
        return reply.status(400).send({ success: false });
    }

    const valid = RazorpayService.verifyWebhook(raw, signature);
    let payload: any = {};
    try { payload = JSON.parse(raw); } catch { /* keep {} */ }

    const eventType = payload?.event || 'unknown';
    const dedupeId = eventId
        || `${eventType}:${payload?.payload?.payment?.entity?.id || payload?.created_at || Date.now()}`;

    const claim = await BillingRepository.claimWebhook({
        eventId: dedupeId, eventType, payload, signatureValid: valid,
    });

    if (!claim || !claim.id) {
        // Already DONE, or another worker is processing it right now.
        return reply.send({ success: true, duplicate: true });
    }

    if (!valid) {
        req.log.warn({ eventType }, '[billing] webhook signature invalid — recorded, not processed');
        await BillingRepository.markWebhookRejected(claim.id, 'Invalid signature');
        return reply.status(400).send({ success: false });
    }

    try {
        await handleWebhook(eventType, payload, dedupeId);
        await BillingRepository.markWebhookDone(claim.id);
    } catch (err: any) {
        req.log.error(err, '[billing] webhook processing failed');
        // The row stays, marked FAILED and reclaimable. 500 so Razorpay retries.
        await BillingRepository.markWebhookFailed(claim.id, err.message ?? 'unknown');
        return reply.status(500).send({ success: false });
    }

    return reply.send({ success: true });
};

async function handleWebhook(eventType: string, payload: any, dedupeId: string): Promise<void> {
    const subEntity = payload?.payload?.subscription?.entity;
    const payEntity = payload?.payload?.payment?.entity;

    switch (eventType) {
        // Status changes only. No money has moved, so no credits.
        case 'subscription.authenticated':
        case 'subscription.activated':
        case 'subscription.updated':
        case 'subscription.pending':
        case 'subscription.halted':
        case 'subscription.paused':
        case 'subscription.resumed':
        case 'subscription.cancelled':
        // 'expired' is terminal: the customer never authenticated before start_at.
        // Without this the row stays at 'created'/'authenticated', which
        // ux_sub_org_live treats as live — and that organisation could then never
        // create another subscription.
        case 'subscription.expired':
        case 'subscription.completed': {
            if (!subEntity) return;
            await BillingRepository.updateSubscriptionFromWebhook({
                razorpaySubscriptionId: subEntity.id,
                status: subEntity.status,
                currentStart: subEntity.current_start ?? null,
                currentEnd: subEntity.current_end ?? null,
            });
            return;
        }

        // ── THE ONE THAT GRANTS CREDITS ──
        // Money has actually moved. Not `authenticated`, not `activated`.
        case 'subscription.charged': {
            if (!subEntity) return;
            const s = await BillingRepository.findSubscriptionWithPlan(subEntity.id);
            if (!s) {
                console.error('[billing] subscription.charged for an unknown subscription', subEntity.id);
                return;
            }

            const start = subEntity.current_start ? new Date(subEntity.current_start * 1000) : new Date();
            const end = subEntity.current_end
                ? new Date(subEntity.current_end * 1000)
                : new Date(start.getTime() + 30 * 864e5);

            await BillingRepository.setSubscriptionPeriod({
                id: s.id, status: subEntity.status || 'active', start, end,
            });

            if (payEntity) {
                await BillingRepository.recordSubscriptionPayment({
                    organisationId: s.organisation_id,
                    subscriptionId: s.id,
                    razorpayPaymentId: payEntity.id,
                    invoiceId: payEntity.invoice_id ?? null,
                    amountMicro: Number(payEntity.amount) * 10_000,
                    method: payEntity.method ?? null,
                    raw: payEntity,
                });
            }

            await CreditService.allocateForPeriod({
                organisationId: s.organisation_id,
                subscriptionId: s.id,
                planCredits: Number(s.included_credits),
                periodStart: start,
                periodEnd: end,
                idempotencyKey: dedupeId,
                rolloverPolicy: s.rollover_policy,
                rolloverCap: s.rollover_cap_credits ? Number(s.rollover_cap_credits) : null,
            });
            return;
        }

        case 'payment.captured': {
            if (!payEntity?.order_id) return;
            await applyTopUpPayment(payEntity);
            return;
        }

        case 'payment.failed': {
            if (!payEntity?.order_id) return;
            await BillingRepository.markPaymentFailed(payEntity.order_id, payEntity);
            return;
        }

        default:
            return;
    }
}
