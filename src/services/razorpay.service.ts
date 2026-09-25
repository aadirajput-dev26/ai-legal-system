import { createHmac, timingSafeEqual } from 'crypto';
import { billingConfig } from '../lib/billing-config.js';

/**
 * RazorpayService — thin REST client over the documented v1 API.
 *
 * Implemented with fetch rather than the SDK so the backend gains no new
 * dependency and the exact request is visible in this file.
 *
 * Endpoints used (all verified against Razorpay's API reference):
 *   POST /v1/plans
 *   POST /v1/subscriptions
 *   GET  /v1/subscriptions/:id
 *   POST /v1/subscriptions/:id/cancel
 *   POST /v1/orders                      ← one-off top-ups
 *   GET  /v1/payments/:id
 *
 * SECURITY
 * Keys live only in the environment. Nothing here is ever sent to the browser
 * except `key_id`, which is public by design and required by Checkout.
 */

const auth = () =>
    'Basic ' + Buffer.from(`${billingConfig.razorpay.keyId}:${billingConfig.razorpay.keySecret}`).toString('base64');

async function call<T = any>(path: string, init?: RequestInit): Promise<T> {
    if (!billingConfig.razorpay.configured) {
        throw Object.assign(new Error('Razorpay is not configured on this server.'), { code: 'RAZORPAY_NOT_CONFIGURED' });
    }
    const res = await fetch(`${billingConfig.razorpay.apiBase}${path}`, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            Authorization: auth(),
            ...(init?.headers || {}),
        },
    });
    const text = await res.text();
    let body: any;
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }

    if (!res.ok) {
        const msg = body?.error?.description || `Razorpay ${res.status}`;
        throw Object.assign(new Error(msg), { status: res.status, body });
    }
    return body as T;
}

export class RazorpayService {
    static get publicKeyId() { return billingConfig.razorpay.keyId; }
    static get configured() { return billingConfig.razorpay.configured; }

    /** Create the recurring plan. Run once per plan; store the id on `plans`. */
    static createPlan(args: { amountPaise: number; name: string; description?: string }) {
        if (!billingConfig.razorpay.configured) {
            console.log('[Mock Razorpay] Created Plan:', args);
            return Promise.resolve({ id: `plan_mock_${Date.now()}` });
        }
        return call('/plans', {
            method: 'POST',
            body: JSON.stringify({
                period: 'monthly',
                interval: 1,
                item: {
                    name: args.name,
                    description: args.description,
                    amount: args.amountPaise,
                    currency: 'INR',
                },
            }),
        });
    }

    /**
     * Create a subscription for a customer to authorise.
     * `total_count` is how many cycles Razorpay will attempt — 120 is ten years,
     * effectively "until cancelled".
     */
    static createSubscription(args: {
        planId: string;
        totalCount?: number;
        notes?: Record<string, string>;
        customerNotify?: boolean;
    }) {
        if (!billingConfig.razorpay.configured) {
            console.log('[Mock Razorpay] Created Subscription:', args);
            return Promise.resolve({ id: `sub_mock_${Date.now()}`, status: 'created' });
        }
        return call('/subscriptions', {
            method: 'POST',
            body: JSON.stringify({
                plan_id: args.planId,
                total_count: args.totalCount ?? 120,
                customer_notify: args.customerNotify === false ? 0 : 1,
                notes: args.notes ?? {},
            }),
        });
    }

    static getSubscription(id: string) {
        return call(`/subscriptions/${id}`);
    }

    static cancelSubscription(id: string, atCycleEnd = true) {
        return call(`/subscriptions/${id}/cancel`, {
            method: 'POST',
            body: JSON.stringify({ cancel_at_cycle_end: atCycleEnd ? 1 : 0 }),
        });
    }

    /** One-off order for a credit top-up (pay as you go). */
    static createOrder(args: { amountPaise: number; receipt: string; notes?: Record<string, string> }) {
        return call('/orders', {
            method: 'POST',
            body: JSON.stringify({
                amount: args.amountPaise,
                currency: 'INR',
                receipt: args.receipt,
                notes: args.notes ?? {},
                payment_capture: 1,
            }),
        });
    }

    static getPayment(id: string) {
        return call(`/payments/${id}`);
    }

    // ── Signature verification ──────────────────────────────────────

    private static safeEqual(a: string, b: string): boolean {
        const x = Buffer.from(a, 'utf8');
        const y = Buffer.from(b, 'utf8');
        if (x.length !== y.length) return false;
        return timingSafeEqual(x, y);
    }

    /**
     * Checkout handback for a one-off order.
     * HMAC-SHA256 of `${order_id}|${payment_id}` with the KEY SECRET.
     */
    static verifyOrderSignature(args: {
        orderId: string; paymentId: string; signature: string;
    }): boolean {
        if (!billingConfig.razorpay.keySecret) return false;
        const expected = createHmac('sha256', billingConfig.razorpay.keySecret)
            .update(`${args.orderId}|${args.paymentId}`)
            .digest('hex');
        return RazorpayService.safeEqual(expected, args.signature || '');
    }

    /**
     * Checkout handback for a subscription.
     * HMAC-SHA256 of `${payment_id}|${subscription_id}` — note the order is the
     * reverse of the order flow above. Getting this backwards is the classic bug.
     */
    static verifySubscriptionSignature(args: {
        subscriptionId: string; paymentId: string; signature: string;
    }): boolean {
        if (!billingConfig.razorpay.keySecret) return false;
        const expected = createHmac('sha256', billingConfig.razorpay.keySecret)
            .update(`${args.paymentId}|${args.subscriptionId}`)
            .digest('hex');
        return RazorpayService.safeEqual(expected, args.signature || '');
    }

    /**
     * Webhook signature. HMAC-SHA256 over the RAW request body using the
     * WEBHOOK SECRET — which is a different secret from the API key secret.
     *
     * The body must be the exact bytes Razorpay sent. JSON.parse followed by
     * JSON.stringify changes them and the HMAC will never match; app.ts keeps
     * the raw buffer for this route specifically.
     */
    static verifyWebhook(rawBody: string | Buffer, signature: string): boolean {
        if (!billingConfig.razorpay.webhookSecret) return false;
        const expected = createHmac('sha256', billingConfig.razorpay.webhookSecret)
            .update(rawBody)
            .digest('hex');
        return RazorpayService.safeEqual(expected, signature || '');
    }
}
