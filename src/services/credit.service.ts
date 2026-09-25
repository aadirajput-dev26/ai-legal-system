import type { PoolClient } from 'pg';
import pool from '../lib/db.js';
import { billingConfig, MICRO, creditsFromMicro } from '../lib/billing-config.js';

/**
 * CreditService — the credit ledger.
 *
 * RULES
 * 1. The balance IS the ledger. Every movement is an append-only row carrying
 *    the running balance, so any figure can be explained by replaying entries.
 * 2. Nothing here opens its own transaction when it takes a `client` — the
 *    caller owns the transaction so usage and consumption commit together.
 * 3. Every write that could be retried carries an idempotency key.
 */

export interface Balance {
    organisationId: string;
    balanceMicro: number;
    balanceCredits: number;
    allocatedCredits: number;
    toppedUpCredits: number;
    consumedCredits: number;
    periodStart: string | null;
    periodEnd: string | null;
    billingPeriodId: string | null;
    hasSubscription: boolean;
    subscriptionStatus: string | null;
}

export class CreditService {
    /** The open billing period, or null when the org has never subscribed. */
    static async currentPeriodId(client: PoolClient, organisationId: string): Promise<string | null> {
        const r = await client.query(
            `SELECT id FROM billing_periods
              WHERE organisation_id = $1 AND status = 'OPEN'
              ORDER BY period_start DESC LIMIT 1`,
            [organisationId],
        );
        return r.rows[0]?.id ?? null;
    }

    /** Current balance in micro-credits. Derived, never cached. */
    static async balanceMicro(client: PoolClient | typeof pool, organisationId: string): Promise<number> {
        const r = await client.query(
            `SELECT COALESCE(SUM(delta_credits_micro), 0)::bigint AS bal
               FROM credit_ledger WHERE organisation_id = $1`,
            [organisationId],
        );
        return Number(r.rows[0]?.bal ?? 0);
    }

    /** Everything the billing screen needs, in one round trip. */
    static async summary(organisationId: string): Promise<Balance> {
        const [bal, period, sub] = await Promise.all([
            CreditService.balanceMicro(pool, organisationId),
            pool.query(
                `SELECT id, period_start, period_end, allocated_credits,
                        rolled_over_credits, topped_up_credits, consumed_credits_micro
                   FROM billing_periods
                  WHERE organisation_id = $1 AND status = 'OPEN'
                  ORDER BY period_start DESC LIMIT 1`,
                [organisationId],
            ),
            pool.query(
                `SELECT status FROM subscriptions
                  WHERE organisation_id = $1
                  ORDER BY created_at DESC LIMIT 1`,
                [organisationId],
            ),
        ]);

        const p = period.rows[0];
        return {
            organisationId,
            balanceMicro: bal,
            balanceCredits: creditsFromMicro(bal),
            allocatedCredits: Number(p?.allocated_credits ?? 0) + Number(p?.rolled_over_credits ?? 0),
            toppedUpCredits: Number(p?.topped_up_credits ?? 0),
            consumedCredits: creditsFromMicro(Number(p?.consumed_credits_micro ?? 0)),
            periodStart: p?.period_start ?? null,
            periodEnd: p?.period_end ?? null,
            billingPeriodId: p?.id ?? null,
            hasSubscription: Boolean(sub.rows[0]),
            subscriptionStatus: sub.rows[0]?.status ?? null,
        };
    }

    /**
     * Can this organisation start another AI operation?
     * Deliberately a cheap read — it sits in front of every AI request.
     */
    static async canSpend(organisationId: string | null | undefined): Promise<{
        allowed: boolean;
        reason?: 'NO_SUBSCRIPTION' | 'INSUFFICIENT_CREDITS';
        balanceCredits: number;
    }> {
        if (!billingConfig.enforcementEnabled || !organisationId) {
            return { allowed: true, balanceCredits: 0 };
        }
        const bal = await CreditService.balanceMicro(pool, organisationId);
        const credits = creditsFromMicro(bal);
        if (credits >= billingConfig.minBalanceCredits) {
            return { allowed: true, balanceCredits: credits };
        }
        const sub = await pool.query(
            `SELECT 1 FROM subscriptions
              WHERE organisation_id = $1 AND status IN ('active','authenticated')
              LIMIT 1`,
            [organisationId],
        );
        return {
            allowed: false,
            reason: sub.rowCount ? 'INSUFFICIENT_CREDITS' : 'NO_SUBSCRIPTION',
            balanceCredits: credits,
        };
    }

    /** Append an entry and return the new balance. Caller owns the transaction. */
    private static async append(
        client: PoolClient,
        row: {
            organisationId: string;
            billingPeriodId?: string | null;
            entryType: string;
            deltaMicro: number;
            usageEventId?: string | null;
            paymentId?: string | null;
            idempotencyKey?: string | null;
            reason?: string | null;
            createdBy?: string | null;
        },
    ): Promise<number | null> {
        // Serialise per organisation so two concurrent writes cannot both read
        // the same balance and each write a wrong balance_after.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [row.organisationId]);

        const current = await CreditService.balanceMicro(client, row.organisationId);
        const after = current + row.deltaMicro;

        const res = await client.query(
            `INSERT INTO credit_ledger (
                organisation_id, billing_period_id, entry_type, delta_credits_micro,
                balance_after_micro, usage_event_id, payment_id, idempotency_key,
                reason, created_by
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [
                row.organisationId, row.billingPeriodId ?? null, row.entryType, row.deltaMicro,
                after, row.usageEventId ?? null, row.paymentId ?? null,
                row.idempotencyKey ?? null, row.reason ?? null, row.createdBy ?? null,
            ],
        );

        // Conflict means this exact movement is already in the ledger.
        return res.rowCount === 0 ? null : after;
    }

    /** Deduct for one usage event. Idempotent via ux_ledger_usage. */
    static async consume(
        client: PoolClient,
        args: {
            organisationId: string;
            billingPeriodId?: string | null;
            usageEventId: string;
            creditsMicro: number;
            reason?: string;
        },
    ): Promise<void> {
        const applied = await CreditService.append(client, {
            organisationId: args.organisationId,
            billingPeriodId: args.billingPeriodId,
            entryType: 'CONSUMPTION',
            deltaMicro: -Math.abs(args.creditsMicro),
            usageEventId: args.usageEventId,
            reason: args.reason,
        });
        if (applied === null) return;

        if (args.billingPeriodId) {
            await client.query(
                `UPDATE billing_periods
                    SET consumed_credits_micro = consumed_credits_micro + $2
                  WHERE id = $1`,
                [args.billingPeriodId, Math.abs(args.creditsMicro)],
            );
        }
    }

    /**
     * Open a new billing period and grant the plan's allowance.
     * Called ONLY from a verified `subscription.charged` webhook.
     * Idempotent on the Razorpay event id.
     */
    static async allocateForPeriod(args: {
        organisationId: string;
        subscriptionId: string | null;
        planCredits: number;
        periodStart: Date;
        periodEnd: Date;
        idempotencyKey: string;
        rolloverPolicy?: 'EXPIRE' | 'FULL' | 'CAPPED';
        rolloverCap?: number | null;
    }): Promise<void> {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Close any period still open, applying the rollover policy.
            const open = await client.query(
                `SELECT id FROM billing_periods
                  WHERE organisation_id = $1 AND status = 'OPEN' FOR UPDATE`,
                [args.organisationId],
            );

            let rolled = 0;
            if (open.rowCount) {
                const leftover = await CreditService.balanceMicro(client, args.organisationId);
                const policy = args.rolloverPolicy ?? 'EXPIRE';

                if (leftover > 0 && policy !== 'EXPIRE') {
                    const capMicro = policy === 'CAPPED' && args.rolloverCap
                        ? args.rolloverCap * MICRO
                        : leftover;
                    rolled = Math.min(leftover, capMicro);
                }

                // Zero the balance, then re-grant whatever rolls over. Doing it
                // in two entries keeps the statement readable to a human.
                if (leftover !== 0) {
                    await CreditService.append(client, {
                        organisationId: args.organisationId,
                        billingPeriodId: open.rows[0].id,
                        entryType: 'EXPIRY',
                        deltaMicro: -leftover,
                        idempotencyKey: `${args.idempotencyKey}:expiry`,
                        reason: 'End of billing period',
                    });
                }

                await client.query(
                    `UPDATE billing_periods SET status = 'CLOSED' WHERE id = $1`,
                    [open.rows[0].id],
                );
            }

            const period = await client.query(
                `INSERT INTO billing_periods (
                    organisation_id, subscription_id, period_start, period_end,
                    allocated_credits, rolled_over_credits, status
                 ) VALUES ($1,$2,$3,$4,$5,$6,'OPEN')
                 ON CONFLICT (organisation_id, period_start) DO NOTHING
                 RETURNING id`,
                [
                    args.organisationId, args.subscriptionId,
                    args.periodStart, args.periodEnd,
                    args.planCredits, Math.floor(rolled / MICRO),
                ],
            );

            if (period.rowCount === 0) {
                // This period already exists — a duplicate webhook. Stop.
                await client.query('ROLLBACK');
                return;
            }

            const periodId = period.rows[0].id;

            await CreditService.append(client, {
                organisationId: args.organisationId,
                billingPeriodId: periodId,
                entryType: 'ALLOCATION',
                deltaMicro: args.planCredits * MICRO,
                idempotencyKey: `${args.idempotencyKey}:allocation`,
                reason: 'Monthly plan allowance',
            });

            if (rolled > 0) {
                await CreditService.append(client, {
                    organisationId: args.organisationId,
                    billingPeriodId: periodId,
                    entryType: 'ROLLOVER',
                    deltaMicro: rolled,
                    idempotencyKey: `${args.idempotencyKey}:rollover`,
                    reason: 'Carried over from the previous period',
                });
            }

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
        } finally {
            client.release();
        }
    }

    /**
     * Grant top-up credits after a captured payment.
     * Idempotent on the Razorpay payment id.
     */
    static async grantTopUp(args: {
        organisationId: string;
        credits: number;
        paymentId: string;
        razorpayPaymentId: string;
        createdBy?: string | null;
    }): Promise<void> {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const periodId = await CreditService.currentPeriodId(client, args.organisationId);

            const applied = await CreditService.append(client, {
                organisationId: args.organisationId,
                billingPeriodId: periodId,
                entryType: 'TOPUP',
                deltaMicro: args.credits * MICRO,
                paymentId: args.paymentId,
                idempotencyKey: `topup:${args.razorpayPaymentId}`,
                reason: 'Credit top-up',
                createdBy: args.createdBy,
            });

            if (applied !== null && periodId) {
                await client.query(
                    `UPDATE billing_periods
                        SET topped_up_credits = topped_up_credits + $2 WHERE id = $1`,
                    [periodId, args.credits],
                );
            }
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
        } finally {
            client.release();
        }
    }

    /**
     * Per-user and per-feature breakdown for the current period.
     *
     * Only COMPLETED events count. A cancelled or failed turn takes no credits,
     * so including it would show a customer "2 operations, 1 credit" and invite
     * a support ticket. Failures are still on usage_events for internal analysis.
     */
    static async breakdown(organisationId: string) {
        const [byUser, byFeature] = await Promise.all([
            pool.query(
                `SELECT u.id, u.name, u.email,
                        COALESCE(SUM(e.credits_consumed_micro),0)::bigint AS micro,
                        COUNT(e.id)::int AS operations
                   FROM usage_events e
                   JOIN users u ON u.id = e.user_id
                  WHERE e.organisation_id = $1
                    AND e.status = 'COMPLETED'
                    AND e.created_at >= date_trunc('month', now())
                  GROUP BY u.id, u.name, u.email
                  ORDER BY micro DESC`,
                [organisationId],
            ),
            pool.query(
                `SELECT feature,
                        COALESCE(SUM(credits_consumed_micro),0)::bigint AS micro,
                        COALESCE(SUM(underlying_cost_micro),0)::bigint AS cost_micro,
                        COUNT(*)::int AS operations
                   FROM usage_events
                  WHERE organisation_id = $1
                    AND status = 'COMPLETED'
                    AND created_at >= date_trunc('month', now())
                  GROUP BY feature
                  ORDER BY micro DESC`,
                [organisationId],
            ),
        ]);

        return {
            byUser: byUser.rows.map(r => ({
                userId: r.id, name: r.name, email: r.email,
                credits: creditsFromMicro(r.micro), operations: r.operations,
            })),
            byFeature: byFeature.rows.map(r => ({
                feature: r.feature,
                credits: creditsFromMicro(r.micro),
                underlyingCostMicro: Number(r.cost_micro),
                operations: r.operations,
            })),
        };
    }

    static async grantSignupBonus(args: {
        organisationId: string;
        credits: number;
    }): Promise<void> {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const periodId = await CreditService.currentPeriodId(client, args.organisationId);

            const applied = await CreditService.append(client, {
                organisationId: args.organisationId,
                billingPeriodId: periodId,
                entryType: 'TOPUP',
                deltaMicro: args.credits * MICRO,
                idempotencyKey: `signup_bonus:${args.organisationId}`,
                reason: 'Signup Bonus Tokens',
            });

            if (applied !== null && periodId) {
                await client.query(
                    `UPDATE billing_periods
                        SET topped_up_credits = topped_up_credits + $2 WHERE id = $1`,
                    [periodId, args.credits],
                );
            }
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
        } finally {
            client.release();
        }
    }

    /** Recent ledger entries, newest first — the customer-facing statement. */
    static async statement(organisationId: string, limit = 50) {
        const r = await pool.query(
            `SELECT l.entry_type, l.delta_credits_micro, l.balance_after_micro,
                    l.reason, l.created_at, e.feature, e.model, e.total_tokens
               FROM credit_ledger l
               LEFT JOIN usage_events e ON e.id = l.usage_event_id
              WHERE l.organisation_id = $1
              ORDER BY l.created_at DESC
              LIMIT $2`,
            [organisationId, Math.min(limit, 200)],
        );
        return r.rows.map(x => ({
            type: x.entry_type,
            credits: Number(x.delta_credits_micro) / MICRO,
            balanceAfter: creditsFromMicro(x.balance_after_micro),
            reason: x.reason,
            feature: x.feature,
            model: x.model,
            tokens: x.total_tokens,
            at: x.created_at,
        }));
    }
}
