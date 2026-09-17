/**
 * billing-config.ts — every commercial number in one place.
 *
 * Nothing in this file may be hard-coded anywhere else. The business must be
 * able to change the markup or the credit rate without a code change, so these
 * read from the environment and are SNAPSHOTTED onto every usage_event.
 */

/** Micro-units: 1_000_000 micro = ₹1, or 1 credit. Integers only, never float. */
export const MICRO = 1_000_000;

const num = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const billingConfig = {
    /** Multiplier applied to underlying cost to reach customer value. */
    markupMultiplier: num(process.env.BILLING_MARKUP, 2),

    /** USD → INR. Recorded per event so history never re-prices. */
    fxUsdInr: num(process.env.BILLING_FX_USD_INR, 90),

    /** Micro-INR that one credit is worth. 10_000 = ₹0.01 per credit. */
    creditRateMicro: Math.round(num(process.env.BILLING_CREDIT_RATE_MICRO, 10_000)),

    /**
     * Balance floor, in whole credits, below which a new AI operation is
     * refused. Sized above the largest single operation we have observed so a
     * request can never complete into a negative balance.
     */
    minBalanceCredits: Math.round(num(process.env.BILLING_MIN_BALANCE_CREDITS, 200)),

    /** Turn enforcement off and keep only measurement. Phase 0 / incidents. */
    enforcementEnabled: process.env.BILLING_ENFORCEMENT !== 'false',

    /** What customers see this unit called. "Tokens" or "Credits". */
    creditLabel: process.env.BILLING_CREDIT_LABEL || 'Tokens',

    razorpay: {
        keyId: process.env.RAZORPAY_KEY_ID || '',
        keySecret: process.env.RAZORPAY_KEY_SECRET || '',
        webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
        apiBase: 'https://api.razorpay.com/v1',
        get configured() {
            return Boolean(this.keyId && this.keySecret);
        },
    },
} as const;

/** Rupees (float, display only) → micro-INR (integer, storage). */
export const toMicro = (rupees: number) => Math.round(rupees * MICRO);

/** micro-INR → rupees, for display. Never feed this back into arithmetic. */
export const fromMicro = (micro: number | string) => Number(micro) / MICRO;

/** micro-INR → paise, which is the unit every Razorpay amount uses. */
export const microToPaise = (micro: number | string) => Math.round(Number(micro) / 10_000);

/** Whole credits (display) from micro-credits (storage). Always rounds up so
 *  we never show a customer more balance than they have. */
export const creditsFromMicro = (micro: number | string) => Math.floor(Number(micro) / MICRO);

export const formatINR = (micro: number | string) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })
        .format(fromMicro(micro));
