import pool from '../lib/db.js';

/**
 * billing.repository.ts — every billing SQL statement lives here.
 *
 * Matches the pattern used by case.repository.ts and task.repository.ts: the
 * controller parses the request and shapes the response; nothing in the
 * controller touches `pool` directly.
 */

export interface OrgMembership {
    id: string;
    name: string;
    role: string;
    isAdmin: boolean;
}

export interface PlanRow {
    id: string;
    code: string;
    name: string;
    description: string | null;
    razorpay_plan_id: string | null;
    price_micro: string;
    included_credits: string;
    seat_limit: number | null;
    rollover_policy: 'EXPIRE' | 'FULL' | 'CAPPED';
    rollover_cap_credits: string | null;
    overage_policy: string;
}

export interface CreditPackRow {
    id: string;
    code: string;
    name: string;
    price_micro: string;
    credits: string;
}

export class BillingRepository {

    // ── Organisations ───────────────────────────────────────────────

    /** Every organisation this user belongs to, with their role. */
    static async listMemberships(userId: string): Promise<OrgMembership[]> {
        const r = await pool.query(
            `SELECT om.organisation_id, om.role, o.name
               FROM organisation_members om
               JOIN organisations o ON o.id = om.organisation_id
              WHERE om.user_id = $1
              ORDER BY o.name, om.organisation_id`,
            [userId],
        );
        return r.rows.map(x => ({
            id: x.organisation_id,
            name: x.name,
            role: x.role,
            isAdmin: x.role === 'ADMIN',
        }));
    }

    /** One membership, or null when the user is not in that organisation. */
    static async getMembership(userId: string, organisationId: string): Promise<OrgMembership | null> {
        const r = await pool.query(
            `SELECT om.organisation_id, om.role, o.name
               FROM organisation_members om
               JOIN organisations o ON o.id = om.organisation_id
              WHERE om.user_id = $1 AND om.organisation_id = $2`,
            [userId, organisationId],
        );
        if (!r.rowCount) return null;
        const x = r.rows[0];
        return { id: x.organisation_id, name: x.name, role: x.role, isAdmin: x.role === 'ADMIN' };
    }

    // ── Catalogue ───────────────────────────────────────────────────

    static async listPlans(): Promise<PlanRow[]> {
        const r = await pool.query(
            `SELECT id, code, name, description, razorpay_plan_id, price_micro,
                    included_credits, seat_limit, rollover_policy,
                    rollover_cap_credits, overage_policy
               FROM plans WHERE active ORDER BY sort_order`,
        );
        return r.rows;
    }

    static async findPlanByCode(code: string): Promise<PlanRow | null> {
        const r = await pool.query(
            `SELECT * FROM plans WHERE code = $1 AND active`, [code],
        );
        return r.rows[0] ?? null;
    }

    static async setRazorpayPlanId(planId: string, razorpayPlanId: string): Promise<void> {
        await pool.query(
            `UPDATE plans SET razorpay_plan_id = $2 WHERE id = $1`, [planId, razorpayPlanId],
        );
    }

    static async listPacks(): Promise<CreditPackRow[]> {
        const r = await pool.query(
            `SELECT id, code, name, price_micro, credits
               FROM credit_packs WHERE active ORDER BY sort_order`,
        );
        return r.rows;
    }

    static async findPackByCode(code: string): Promise<CreditPackRow | null> {
        const r = await pool.query(
            `SELECT * FROM credit_packs WHERE code = $1 AND active`, [code],
        );
        return r.rows[0] ?? null;
    }

    // ── Subscriptions ───────────────────────────────────────────────

    static async upsertSubscription(args: {
        organisationId: string;
        planId: string;
        razorpaySubscriptionId: string;
        status: string;
        createdBy: string;
    }): Promise<void> {
        await pool.query(
            `INSERT INTO subscriptions (organisation_id, plan_id, razorpay_subscription_id, status, created_by)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (razorpay_subscription_id)
             DO UPDATE SET status = EXCLUDED.status, updated_at = now()`,
            [args.organisationId, args.planId, args.razorpaySubscriptionId, args.status, args.createdBy],
        );
    }

    static async findLiveSubscription(organisationId: string) {
        const r = await pool.query(
            `SELECT id, razorpay_subscription_id FROM subscriptions
              WHERE organisation_id = $1 AND status IN ('active','authenticated','pending','paused')
              ORDER BY created_at DESC LIMIT 1`,
            [organisationId],
        );
        return r.rows[0] ?? null;
    }

    static async findSubscriptionWithPlan(razorpaySubscriptionId: string) {
        const r = await pool.query(
            `SELECT s.id, s.organisation_id,
                    p.included_credits, p.rollover_policy, p.rollover_cap_credits
               FROM subscriptions s JOIN plans p ON p.id = s.plan_id
              WHERE s.razorpay_subscription_id = $1`,
            [razorpaySubscriptionId],
        );
        return r.rows[0] ?? null;
    }

    static async updateSubscriptionFromWebhook(args: {
        razorpaySubscriptionId: string;
        status: string;
        currentStart: number | null;
        currentEnd: number | null;
    }): Promise<void> {
        await pool.query(
            `UPDATE subscriptions
                SET status = $2,
                    current_period_start = CASE WHEN $3::bigint IS NULL
                        THEN current_period_start ELSE to_timestamp($3::bigint) END,
                    current_period_end = CASE WHEN $4::bigint IS NULL
                        THEN current_period_end ELSE to_timestamp($4::bigint) END,
                    updated_at = now()
              WHERE razorpay_subscription_id = $1`,
            [args.razorpaySubscriptionId, args.status, args.currentStart, args.currentEnd],
        );
    }

    static async setSubscriptionPeriod(args: {
        id: string; status: string; start: Date; end: Date;
    }): Promise<void> {
        await pool.query(
            `UPDATE subscriptions
                SET status = $2, current_period_start = $3, current_period_end = $4, updated_at = now()
              WHERE id = $1`,
            [args.id, args.status, args.start, args.end],
        );
    }

    static async markCancelAtPeriodEnd(razorpaySubscriptionId: string): Promise<void> {
        await pool.query(
            `UPDATE subscriptions SET cancel_at_period_end = true, updated_at = now()
              WHERE razorpay_subscription_id = $1`,
            [razorpaySubscriptionId],
        );
    }

    // ── Payments ────────────────────────────────────────────────────

    static async createTopUpPayment(args: {
        organisationId: string; packId: string; amountMicro: string; createdBy: string;
    }): Promise<string> {
        const r = await pool.query(
            `INSERT INTO payments (organisation_id, kind, credit_pack_id, amount_micro,
                                   status, credits_granted, created_by)
             VALUES ($1,'TOPUP',$2,$3,'created',0,$4) RETURNING id`,
            [args.organisationId, args.packId, args.amountMicro, args.createdBy],
        );
        return r.rows[0].id;
    }

    static async attachOrderId(paymentId: string, orderId: string): Promise<void> {
        await pool.query(
            `UPDATE payments SET razorpay_order_id = $2 WHERE id = $1`, [paymentId, orderId],
        );
    }

    /** The pending top-up row for a Razorpay order. Unique by ux_payments_order. */
    static async findTopUpByOrderId(orderId: string) {
        const r = await pool.query(
            `SELECT p.id, p.organisation_id, p.status, cp.credits
               FROM payments p
               LEFT JOIN credit_packs cp ON cp.id = p.credit_pack_id
              WHERE p.razorpay_order_id = $1 AND p.kind = 'TOPUP'`,
            [orderId],
        );
        return r.rows[0] ?? null;
    }

    static async captureTopUpPayment(args: {
        paymentId: string; razorpayPaymentId: string; method: string | null;
        credits: number; raw: unknown;
    }): Promise<void> {
        await pool.query(
            `UPDATE payments
                SET razorpay_payment_id = $2, status = 'captured', method = $3,
                    captured_at = now(), credits_granted = $4, raw = $5
              WHERE id = $1 AND status <> 'captured'`,
            [args.paymentId, args.razorpayPaymentId, args.method, args.credits, JSON.stringify(args.raw)],
        );
    }

    static async recordSubscriptionPayment(args: {
        organisationId: string; subscriptionId: string; razorpayPaymentId: string;
        invoiceId: string | null; amountMicro: number; method: string | null; raw: unknown;
    }): Promise<void> {
        await pool.query(
            `INSERT INTO payments (organisation_id, subscription_id, kind,
                                   razorpay_payment_id, razorpay_invoice_id,
                                   amount_micro, status, method, captured_at, raw)
             VALUES ($1,$2,'SUBSCRIPTION',$3,$4,$5,'captured',$6,now(),$7)
             ON CONFLICT (razorpay_payment_id) DO NOTHING`,
            [
                args.organisationId, args.subscriptionId, args.razorpayPaymentId,
                args.invoiceId, args.amountMicro, args.method, JSON.stringify(args.raw),
            ],
        );
    }

    static async markPaymentFailed(orderId: string, raw: unknown): Promise<void> {
        await pool.query(
            `UPDATE payments SET status = 'failed', raw = $2
              WHERE razorpay_order_id = $1 AND status <> 'captured'`,
            [orderId, JSON.stringify(raw)],
        );
    }

    // ── Webhook inbox ───────────────────────────────────────────────

    /**
     * Record a delivery and decide whether to process it.
     *
     * Returns the row id when this delivery should be processed, or null when
     * it should be skipped — which happens only when it is already DONE, or
     * another worker currently holds it.
     *
     * The status column is what makes a retry safe after a hard kill: a row
     * stuck at PENDING is claimable, so Razorpay's retry is processed rather
     * than deduplicated away.
     */
    static async claimWebhook(args: {
        eventId: string; eventType: string; payload: unknown; signatureValid: boolean;
    }): Promise<{ id: string; alreadyDone: boolean } | null> {
        const ins = await pool.query(
            `INSERT INTO webhook_events (provider, event_id, event_type, payload, signature_valid, status, attempts)
             VALUES ('razorpay', $1, $2, $3, $4, 'PROCESSING', 1)
             ON CONFLICT (provider, event_id) DO NOTHING
             RETURNING id`,
            [args.eventId, args.eventType, args.payload, args.signatureValid],
        );
        if (ins.rowCount) return { id: ins.rows[0].id, alreadyDone: false };

        // Seen before. Claim it only if it is not finished and nobody else holds it.
        const claim = await pool.query(
            `UPDATE webhook_events
                SET status = 'PROCESSING', attempts = attempts + 1
              WHERE provider = 'razorpay' AND event_id = $1
                AND status IN ('PENDING','FAILED')
              RETURNING id`,
            [args.eventId],
        );
        if (claim.rowCount) return { id: claim.rows[0].id, alreadyDone: false };

        const existing = await pool.query(
            `SELECT status FROM webhook_events WHERE provider = 'razorpay' AND event_id = $1`,
            [args.eventId],
        );
        return { id: '', alreadyDone: existing.rows[0]?.status === 'DONE' };
    }

    static async markWebhookDone(id: string): Promise<void> {
        await pool.query(
            `UPDATE webhook_events SET status = 'DONE', processed_at = now(), error = NULL WHERE id = $1`,
            [id],
        );
    }

    /** Never deletes the row — a FAILED delivery stays visible and reclaimable. */
    static async markWebhookFailed(id: string, error: string): Promise<void> {
        await pool.query(
            `UPDATE webhook_events SET status = 'FAILED', error = $2 WHERE id = $1`,
            [id, error.slice(0, 2000)],
        );
    }

    static async markWebhookRejected(id: string, error: string): Promise<void> {
        await pool.query(
            `UPDATE webhook_events SET status = 'FAILED', error = $2, processed_at = now() WHERE id = $1`,
            [id, error.slice(0, 2000)],
        );
    }
}
