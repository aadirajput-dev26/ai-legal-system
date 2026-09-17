import { FastifyRequest, FastifyReply } from 'fastify';
import pool from '../lib/db.js';
import { billingConfig, microToPaise, fromMicro } from '../lib/billing-config.js';
import { CreditService } from '../services/credit.service.js';
import { RazorpayService } from '../services/razorpay.service.js';

/**
 * billing.controller.ts
 *
 * THE RULE THAT GOVERNS THIS FILE
 * The frontend never grants anything. Checkout success is a UI event only.
 * Entitlement changes come from a signature-verified webhook, or from a
 * server-side fetch of the payment from Razorpay. Never from the browser.
 */

const ok = (reply: FastifyReply, data: any) => reply.send({ success: true, data });
const fail = (reply: FastifyReply, code: number, errCode: string, message: string, extra: any = {}) =>
    reply.status(code).send({ success: false, error: { code: errCode, message, ...extra } });

const userId = (req: FastifyRequest) => (req.user as any)?.userId as string;

/** The caller's organisation, and whether they may change billing for it. */
async function resolveOrg(req: FastifyRequest, orgId?: string) {
    const uid = userId(req);
    const r = await pool.query(
        `SELECT om.organisation_id, om.role, o.name
           FROM organisation_members om
           JOIN organisations o ON o.id = om.organisation_id
          WHERE om.user_id = $1 ${orgId ? 'AND om.organisation_id = $2' : ''}
          ORDER BY om.organisation_id
          LIMIT 1`,
        orgId ? [uid, orgId] : [uid],
    );
    if (!r.rowCount) return null;
    return {
        id: r.rows[0].organisation_id as string,
        name: r.rows[0].name as string,
        role: r.rows[0].role as string,
        isAdmin: r.rows[0].role === 'ADMIN',
    };
}

// ── GET /billing/me ──────────────────────────────────────────────────
export const getBilling = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
        const org = await resolveOrg(req, (req.query as any)?.organisationId);
        if (!org) return fail(reply, 404, 'NO_ORGANISATION', 'You do not belong to an organisation yet.');

        const [summary, plans, packs, breakdown] = await Promise.all([
            CreditService.summary(org.id),
            pool.query(`SELECT code, name, description, price_micro, included_credits, seat_limit,
                               razorpay_plan_id IS NOT NULL AS ready
                          FROM plans WHERE active ORDER BY sort_order`),
            pool.query(`SELECT code, name, price_micro, credits
                          FROM credit_packs WHERE active ORDER BY sort_order`),
            CreditService.breakdown(org.id),
        ]);

        return ok(reply, {
            organisation: { id: org.id, name: org.name, role: org.role },
            creditLabel: billingConfig.creditLabel,
            enforcementEnabled: billingConfig.enforcementEnabled,
            minBalanceCredits: billingConfig.minBalanceCredits,
            razorpayKeyId: RazorpayService.publicKeyId || null,
            razorpayConfigured: RazorpayService.configured,
            balance: summary,
            plans: plans.rows.map(p => ({
                code: p.code, name: p.name, description: p.description,
                priceInr: fromMicro(p.price_micro), includedCredits: Number(p.included_credits),
                seatLimit: p.seat_limit, ready: p.ready,
            })),
            packs: packs.rows.map(p => ({
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
        const org = await resolveOrg(req);
        if (!org) return fail(reply, 404, 'NO_ORGANISATION', 'You do not belong to an organisation yet.');
        const limit = Number((req.query as any)?.limit) || 50;
        return ok(reply, { entries: await CreditService.statement(org.id, limit) });
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
        const org = await resolveOrg(req);
        if (!org) return fail(reply, 404, 'NO_ORGANISATION', 'You do not belong to an organisation yet.');
        if (!org.isAdmin) return fail(reply, 403, 'FORBIDDEN', 'Only an organisation administrator can change the plan.');
        if (!RazorpayService.configured) return fail(reply, 503, 'RAZORPAY_NOT_CONFIGURED', 'Payments are not enabled on this server yet.');

        const { planCode } = (req.body as any) || {};
        const planRes = await pool.query(
            `SELECT * FROM plans WHERE code = $1 AND active`, [planCode || 'PRO'],
        );
        if (!planRes.rowCount) return fail(reply, 404, 'PLAN_NOT_FOUND', 'That plan does not exist.');
        const plan = planRes.rows[0];

        // Lazily create the Razorpay plan the first time it is needed.
        let razorpayPlanId: string = plan.razorpay_plan_id;
        if (!razorpayPlanId) {
            const created = await RazorpayService.createPlan({
                amountPaise: microToPaise(plan.price_micro),
                name: plan.name,
                description: plan.description,
            });
            razorpayPlanId = created.id;
            await pool.query(`UPDATE plans SET razorpay_plan_id = $2 WHERE id = $1`, [plan.id, razorpayPlanId]);
        }

        const sub = await RazorpayService.createSubscription({
            planId: razorpayPlanId,
            notes: { organisation_id: org.id, plan_code: plan.code, created_by: userId(req) },
        });

        await pool.query(
            `INSERT INTO subscriptions (organisation_id, plan_id, razorpay_subscription_id, status, created_by)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (razorpay_subscription_id) DO UPDATE SET status = EXCLUDED.status`,
            [org.id, plan.id, sub.id, sub.status || 'created', userId(req)],
        );

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
// Creates a one-off order for a credit pack. Grants nothing yet.
export const createTopUp = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
        const org = await resolveOrg(req);
        if (!org) return fail(reply, 404, 'NO_ORGANISATION', 'You do not belong to an organisation yet.');
        if (!org.isAdmin) return fail(reply, 403, 'FORBIDDEN', 'Only an organisation administrator can buy credits.');
        if (!RazorpayService.configured) return fail(reply, 503, 'RAZORPAY_NOT_CONFIGURED', 'Payments are not enabled on this server yet.');

        const { packCode } = (req.body as any) || {};
        const packRes = await pool.query(`SELECT * FROM credit_packs WHERE code = $1 AND active`, [packCode]);
        if (!packRes.rowCount) return fail(reply, 404, 'PACK_NOT_FOUND', 'That top-up option does not exist.');
        const pack = packRes.rows[0];

        const payment = await pool.query(
            `INSERT INTO payments (organisation_id, kind, credit_pack_id, amount_micro,
                                   status, credits_granted, created_by)
             VALUES ($1,'TOPUP',$2,$3,'created',0,$4) RETURNING id`,
            [org.id, pack.id, pack.price_micro, userId(req)],
        );
        const paymentRow = payment.rows[0].id;

        const order = await RazorpayService.createOrder({
            amountPaise: microToPaise(pack.price_micro),
            receipt: `topup_${paymentRow}`.slice(0, 40),
            notes: { organisation_id: org.id, pack_code: pack.code, payment_row: paymentRow },
        });

        await pool.query(`UPDATE payments SET razorpay_order_id = $2 WHERE id = $1`, [paymentRow, order.id]);

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
// same credits idempotently, so whichever arrives first wins and the other
// is a no-op.
export const confirmTopUp = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
        const org = await resolveOrg(req);
        if (!org) return fail(reply, 404, 'NO_ORGANISATION', 'You do not belong to an organisation yet.');

        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = (req.body as any) || {};
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return fail(reply, 400, 'MISSING_FIELDS', 'Payment details are incomplete.');
        }

        const valid = RazorpayService.verifyOrderSignature({
            orderId: razorpay_order_id, paymentId: razorpay_payment_id, signature: razorpay_signature,
        });
        if (!valid) return fail(reply, 400, 'BAD_SIGNATURE', 'This payment could not be verified.');

        // Re-fetch from Razorpay. The browser is never the source of truth.
        const payment = await RazorpayService.getPayment(razorpay_payment_id);
        if (payment.status !== 'captured') {
            return fail(reply, 409, 'NOT_CAPTURED', `Payment is ${payment.status}, not captured yet.`);
        }

        await applyTopUpPayment(payment);
        const summary = await CreditService.summary(org.id);
        return ok(reply, { balance: summary });
    } catch (err: any) {
        req.log.error(err);
        return fail(reply, 502, 'RAZORPAY_ERROR', err.message);
    }
};

/** Shared by the confirm route and the webhook. Idempotent both ways. */
async function applyTopUpPayment(payment: any): Promise<void> {
    const row = await pool.query(
        `SELECT p.id, p.organisation_id, p.status, cp.credits
           FROM payments p
           LEFT JOIN credit_packs cp ON cp.id = p.credit_pack_id
          WHERE p.razorpay_order_id = $1 AND p.kind = 'TOPUP'`,
        [payment.order_id],
    );
    if (!row.rowCount) {
        console.error('[billing] captured top-up with no matching payment row', payment.order_id);
        return;
    }
    const p = row.rows[0];

    await pool.query(
        `UPDATE payments
            SET razorpay_payment_id = $2, status = 'captured', method = $3,
                captured_at = now(), credits_granted = $4, raw = $5
          WHERE id = $1 AND status <> 'captured'`,
        [p.id, payment.id, payment.method ?? null, Number(p.credits), JSON.stringify(payment)],
    );

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
        const org = await resolveOrg(req);
        if (!org) return fail(reply, 404, 'NO_ORGANISATION', 'You do not belong to an organisation yet.');
        if (!org.isAdmin) return fail(reply, 403, 'FORBIDDEN', 'Only an organisation administrator can cancel the plan.');

        const sub = await pool.query(
            `SELECT razorpay_subscription_id FROM subscriptions
              WHERE organisation_id = $1 AND status IN ('active','authenticated','pending')
              ORDER BY created_at DESC LIMIT 1`,
            [org.id],
        );
        if (!sub.rowCount) return fail(reply, 404, 'NO_SUBSCRIPTION', 'There is no active subscription to cancel.');

        await RazorpayService.cancelSubscription(sub.rows[0].razorpay_subscription_id, true);
        await pool.query(
            `UPDATE subscriptions SET cancel_at_period_end = true, updated_at = now()
              WHERE razorpay_subscription_id = $1`,
            [sub.rows[0].razorpay_subscription_id],
        );
        return ok(reply, { cancelAtPeriodEnd: true });
    } catch (err: any) {
        req.log.error(err);
        return fail(reply, 502, 'RAZORPAY_ERROR', err.message);
    }
};

// ── POST /webhooks/razorpay ──────────────────────────────────────────
// Public. Signature-verified. Insert first, process second, always 200 on a
// duplicate so Razorpay stops retrying.
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
    const dedupeId = eventId || `${eventType}:${payload?.payload?.payment?.entity?.id || payload?.created_at}`;

    // Record every delivery, valid or not — this is the audit trail.
    const ins = await pool.query(
        `INSERT INTO webhook_events (provider, event_id, event_type, payload, signature_valid)
         VALUES ('razorpay', $1, $2, $3, $4)
         ON CONFLICT (provider, event_id) DO NOTHING
         RETURNING id`,
        [dedupeId, eventType, payload, valid],
    );

    // Already seen. Do not process twice.
    if (ins.rowCount === 0) return reply.send({ success: true, duplicate: true });
    if (!valid) {
        req.log.warn({ eventType }, '[billing] webhook signature invalid — recorded, not processed');
        return reply.status(400).send({ success: false });
    }

    try {
        await handleWebhook(eventType, payload, dedupeId);
        await pool.query(`UPDATE webhook_events SET processed_at = now() WHERE id = $1`, [ins.rows[0].id]);
    } catch (err: any) {
        req.log.error(err, '[billing] webhook processing failed');
        await pool.query(`UPDATE webhook_events SET error = $2 WHERE id = $1`, [ins.rows[0].id, err.message]);
        // 500 so Razorpay retries; the dedupe row is cleared below so the retry can run.
        await pool.query(`DELETE FROM webhook_events WHERE id = $1 AND processed_at IS NULL`, [ins.rows[0].id]);
        return reply.status(500).send({ success: false });
    }

    return reply.send({ success: true });
};

async function handleWebhook(eventType: string, payload: any, dedupeId: string): Promise<void> {
    const subEntity = payload?.payload?.subscription?.entity;
    const payEntity = payload?.payload?.payment?.entity;

    switch (eventType) {
        // Mandate authorised. No money yet, no credits.
        case 'subscription.authenticated':
        case 'subscription.activated':
        case 'subscription.updated':
        case 'subscription.pending':
        case 'subscription.halted':
        case 'subscription.paused':
        case 'subscription.resumed':
        case 'subscription.cancelled':
        case 'subscription.completed': {
            if (!subEntity) return;
            await pool.query(
                `UPDATE subscriptions
                    SET status = $2,
                        current_period_start = to_timestamp($3),
                        current_period_end   = to_timestamp($4),
                        updated_at = now()
                  WHERE razorpay_subscription_id = $1`,
                [
                    subEntity.id,
                    subEntity.status,
                    subEntity.current_start || null,
                    subEntity.current_end || null,
                ],
            );
            return;
        }

        // ── THE ONE THAT GRANTS CREDITS ──
        // Money has actually moved. Not `authenticated`, not `activated`.
        case 'subscription.charged': {
            if (!subEntity) return;
            const sub = await pool.query(
                `SELECT s.id, s.organisation_id, p.included_credits, p.rollover_policy, p.rollover_cap_credits
                   FROM subscriptions s JOIN plans p ON p.id = s.plan_id
                  WHERE s.razorpay_subscription_id = $1`,
                [subEntity.id],
            );
            if (!sub.rowCount) {
                console.error('[billing] subscription.charged for an unknown subscription', subEntity.id);
                return;
            }
            const s = sub.rows[0];

            const start = subEntity.current_start ? new Date(subEntity.current_start * 1000) : new Date();
            const end = subEntity.current_end
                ? new Date(subEntity.current_end * 1000)
                : new Date(start.getTime() + 30 * 864e5);

            await pool.query(
                `UPDATE subscriptions
                    SET status = $2, current_period_start = $3, current_period_end = $4, updated_at = now()
                  WHERE id = $1`,
                [s.id, subEntity.status || 'active', start, end],
            );

            if (payEntity) {
                await pool.query(
                    `INSERT INTO payments (organisation_id, subscription_id, kind,
                                           razorpay_payment_id, razorpay_invoice_id,
                                           amount_micro, status, method, captured_at, raw)
                     VALUES ($1,$2,'SUBSCRIPTION',$3,$4,$5,'captured',$6,now(),$7)
                     ON CONFLICT (razorpay_payment_id) DO NOTHING`,
                    [
                        s.organisation_id, s.id, payEntity.id, payEntity.invoice_id ?? null,
                        Number(payEntity.amount) * 10_000, payEntity.method ?? null,
                        JSON.stringify(payEntity),
                    ],
                );
            }

            await CreditService.allocateForPeriod({
                organisationId: s.organisation_id,
                subscriptionId: s.id,
                planCredits: Number(s.included_credits),
                periodStart: start,
                periodEnd: end,
                idempotencyKey: dedupeId,
                rolloverPolicy: s.rollover_policy,
                rolloverCap: s.rollover_cap_credits,
            });
            return;
        }

        // One-off top-up captured.
        case 'payment.captured': {
            if (!payEntity?.order_id) return;
            await applyTopUpPayment(payEntity);
            return;
        }

        case 'payment.failed': {
            if (!payEntity?.order_id) return;
            await pool.query(
                `UPDATE payments SET status = 'failed', raw = $2
                  WHERE razorpay_order_id = $1 AND status <> 'captured'`,
                [payEntity.order_id, JSON.stringify(payEntity)],
            );
            return;
        }

        default:
            return;
    }
}
