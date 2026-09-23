import { randomUUID } from 'crypto';
import pool from '../lib/db.js';
import { billingConfig, MICRO } from '../lib/billing-config.js';
import { CreditService } from './credit.service.js';

/**
 * UsageService — server-side observation and pricing of AI usage.
 *
 * THE VERIFIED WIRE FORMAT (probe 07 Sep 2026, re-confirmed against the GTWY
 * dashboard 16 Sep 2026). Three event types: `start` ×1, `delta` ×N, `done` ×1.
 *
 *   { "event":"start", "model":"gpt-5-nano", "service":"openai",
 *     "bridge_id":"<agent id>", "message_id":"<uuid>" }
 *   { "event":"delta", "content":"…" }
 *   { "event":"done",
 *     "usage":{ total_tokens, input_tokens, output_tokens, cached_tokens,
 *               reasoning_tokens, cost },
 *     "message_id":"<uuid>", "finish_reason":"completed" }
 *
 * THREE FACTS THAT SHAPE THIS FILE
 *
 * 1. The Gateway computes `cost` itself, in USD. We never recompute it from a
 *    per-model rate table, so there is no rate card to maintain and no drift
 *    when a model's price changes.
 *
 * 2. `input_tokens` ALREADY INCLUDES `cached_tokens`. Verified arithmetically
 *    against the reported cost. Anything that adds them double-counts.
 *
 * 3. `message_id` is stable across `start`, `done` and the history endpoint.
 *    It is the idempotency key — a retry after a 401 refresh reuses it, so the
 *    UNIQUE index on usage_events.gateway_message_id stops a double charge.
 *
 * THE ONE INVARIANT
 * The user's bytes are forwarded FIRST; metering happens after. If anything in
 * here throws, the advocate still gets their answer and we lose one usage
 * record — never the other way round.
 */

export interface GatewayUsage {
    total_tokens?: number;
    input_tokens?: number;
    /** Subset of input_tokens. Do NOT add to input_tokens. */
    cached_tokens?: number;
    output_tokens?: number;
    reasoning_tokens?: number;
    /** Gateway-computed, USD. The authority. */
    cost?: number;
}

export interface MeterContext {
    organisationId?: string | null;
    userId?: string | null;
    caseId?: string | null;
    feature: 'AI_CHAT' | 'DRAFT_GENERATE' | 'DRAFT_REFINE' | 'DOC_OCR' | 'DOC_INDEX' | 'DOC_REINDEX' | 'TOOL_RUN';
    resourceId?: string | null;
}

interface Priced {
    underlyingCostMicro: number;
    customerValueMicro: number;
    creditsConsumedMicro: number;
}

export class UsageService {
    /**
     * Turn a Gateway USD cost into what the customer's balance should lose.
     * Pure arithmetic — no I/O — so it is trivially testable.
     */
    static price(costUsd: number | null | undefined): Priced {
        const { markupMultiplier, fxUsdInr, creditRateMicro } = billingConfig;
        const usd = Number(costUsd) || 0;
        const underlyingCostMicro = Math.round(usd * fxUsdInr * MICRO);
        const customerValueMicro = Math.round(underlyingCostMicro * markupMultiplier);
        const creditsConsumedMicro = Math.round((customerValueMicro / creditRateMicro) * MICRO);
        return { underlyingCostMicro, customerValueMicro, creditsConsumedMicro };
    }

    /**
     * Wraps a Gateway SSE response. Yields every byte onward immediately, then
     * inspects a copy for `start` and `done`. Records usage once the stream
     * ends — by which time the client already has the whole answer.
     *
     * The stream is drained to completion even if the client has gone away,
     * because aborting early loses the `done` event and with it the usage.
     */
    static async *meterStream(
        gatewayResponse: Response,
        ctx: MeterContext,
    ): AsyncGenerator<Buffer> {
        const requestId = randomUUID();
        const startedAt = Date.now();

        const state: {
            model: string | null;
            service: string | null;
            agentId: string | null;
            messageId: string | null;
            usage: GatewayUsage | null;
            finishReason: string | null;
        } = { model: null, service: null, agentId: null, messageId: null, usage: null, finishReason: null };

        const inspect = (rawLine: string): void => {
            let line = rawLine.trim();
            if (!line) return;
            if (line.startsWith('data:')) line = line.slice(5).trim();
            if (!line || line === '[DONE]') return;

            let parsed: any;
            try { parsed = JSON.parse(line); } catch { return; }

            if (parsed.event === 'start') {
                state.model = parsed.model ?? state.model;
                state.service = parsed.service ?? state.service;
                state.agentId = parsed.bridge_id ?? parsed.bridgeId ?? state.agentId;
                state.messageId = parsed.message_id ?? parsed.messageId ?? state.messageId;
            } else if (parsed.event === 'done') {
                state.usage = parsed.usage ?? parsed?.response?.usage ?? state.usage;
                state.messageId = parsed.message_id ?? parsed.messageId ?? state.messageId;
                state.finishReason = parsed.finish_reason ?? parsed.finishReason ?? state.finishReason;
                state.model = parsed?.response?.data?.model ?? state.model;
            }
        };

        const reader = gatewayResponse.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let clientGone = false;

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                // ── forward first, always ──
                if (!clientGone) {
                    try {
                        yield Buffer.from(value);
                    } catch {
                        // Client disconnected. Keep draining so `done` still arrives.
                        clientGone = true;
                    }
                }

                // ── then measure, defensively ──
                try {
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() ?? '';
                    for (const l of lines) inspect(l);
                } catch (err) {
                    console.error('[usage] inspect failed', err);
                }
            }
            if (buffer.trim()) {
                try { inspect(buffer); } catch { /* ignore */ }
            }
        } finally {
            reader.releaseLock();
            // Never let a metering failure surface to the caller.
            void UsageService.record({
                requestId,
                ctx,
                state,
                latencyMs: Date.now() - startedAt,
                status: clientGone ? 'CANCELLED' : (state.usage ? 'COMPLETED' : 'FAILED'),
            }).catch(err => console.error('[usage] record failed', err));
        }
    }

    /**
     * Writes the usage event and its ledger entry in ONE transaction.
     * Idempotent on gateway_message_id: a Gateway turn is charged at most once.
     */
    static async record(args: {
        requestId: string;
        ctx: MeterContext;
        state: {
            model: string | null; service: string | null; agentId: string | null;
            messageId: string | null; usage: GatewayUsage | null; finishReason: string | null;
        };
        latencyMs: number;
        status: 'COMPLETED' | 'FAILED' | 'CANCELLED';
    }): Promise<void> {
        const { requestId, ctx, state, latencyMs, status } = args;
        const u = state.usage;
        const { markupMultiplier, fxUsdInr, creditRateMicro } = billingConfig;

        // A turn that produced no usage costs nothing. Record it so the
        // analytics are honest, but never take credits for it.
        const chargeable = status === 'COMPLETED' && u?.cost != null;
        const priced = chargeable
            ? UsageService.price(u!.cost)
            : { underlyingCostMicro: 0, customerValueMicro: 0, creditsConsumedMicro: 0 };

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const period = ctx.organisationId
                ? await CreditService.currentPeriodId(client, ctx.organisationId)
                : null;

            const inserted = await client.query(
                `INSERT INTO usage_events (
                    organisation_id, user_id, case_id, billing_period_id,
                    feature, resource_id,
                    provider, model, agent_id, gateway_message_id, request_id,
                    input_tokens, output_tokens, cached_tokens, reasoning_tokens, total_tokens,
                    gateway_cost_usd, fx_usd_inr, underlying_cost_micro,
                    markup_multiplier, customer_value_micro,
                    credit_rate_micro, credits_consumed_micro,
                    status, latency_ms, metadata
                 ) VALUES (
                    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
                    $12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26
                 )
                 -- The unique index is PARTIAL (… WHERE gateway_message_id IS NOT NULL),
                 -- so the predicate must be repeated here or Postgres cannot infer it.
                 ON CONFLICT (gateway_message_id) WHERE gateway_message_id IS NOT NULL DO NOTHING
                 RETURNING id`,
                [
                    ctx.organisationId ?? null, ctx.userId ?? null, ctx.caseId ?? null, period,
                    ctx.feature, ctx.resourceId ?? null,
                    state.service, state.model, state.agentId, state.messageId, requestId,
                    u?.input_tokens ?? null, u?.output_tokens ?? null, u?.cached_tokens ?? null,
                    u?.reasoning_tokens ?? null, u?.total_tokens ?? null,
                    u?.cost ?? null, fxUsdInr, priced.underlyingCostMicro,
                    markupMultiplier, priced.customerValueMicro,
                    creditRateMicro, priced.creditsConsumedMicro,
                    status, latencyMs,
                    JSON.stringify({ finishReason: state.finishReason }),
                ],
            );

            // Conflict → the Gateway turn was already recorded. Nothing to do.
            if (inserted.rowCount === 0) {
                await client.query('ROLLBACK');
                return;
            }

            // No open billing period means the organisation has never bought a plan.
            // Record the usage — it still belongs in the analytics — but take no
            // credits, or the balance would go negative against an allowance that
            // was never granted, and the billing page would read "-3 of 0".
            if (chargeable && ctx.organisationId && period && priced.creditsConsumedMicro > 0) {
                await CreditService.consume(client, {
                    organisationId: ctx.organisationId,
                    billingPeriodId: period,
                    usageEventId: inserted.rows[0].id,
                    creditsMicro: priced.creditsConsumedMicro,
                    reason: ctx.feature,
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
     * For operations with no Gateway cost to read — OCR, indexing, tool runs.
     * Records that it happened with a unit count so it can be priced later,
     * once we know what those units cost. Takes no credits today.
     */
    static async recordUnmetered(ctx: MeterContext & { units?: number; unitKind?: string }): Promise<void> {
        const { markupMultiplier, fxUsdInr, creditRateMicro } = billingConfig;
        try {
            await pool.query(
                `INSERT INTO usage_events (
                    organisation_id, user_id, case_id, feature, resource_id,
                    units, unit_kind, fx_usd_inr, markup_multiplier, credit_rate_micro, status
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'UNMETERED')`,
                [
                    ctx.organisationId ?? null, ctx.userId ?? null, ctx.caseId ?? null,
                    ctx.feature, ctx.resourceId ?? null,
                    ctx.units ?? null, ctx.unitKind ?? null,
                    fxUsdInr, markupMultiplier, creditRateMicro,
                ],
            );
        } catch (err) {
            console.error('[usage] recordUnmetered failed', err);
        }
    }
}
