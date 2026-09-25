import 'dotenv/config';
import { z } from 'zod';

const env = z.object({
    PORT         : z.coerce.number().default(8080),
    LOG_LEVEL    : z.string().default('info'),
    DATABASE_URL : z.string().url(),
    JWT_ACCESS_SECRET  : z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
    JWT_REFRESH_SECRET : z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
    HIPPOCAMPUS_HOST_URL : z.string().url(),
    GTWY_PAUTHKEY        : z.string().min(1),
    GTWY_UNIVERSAL_AGENT_ID : z.string().min(1),
    NOTIFICATION_WEBHOOK_URL : z.string().url().optional(),
    VIASOCKET_ACCESS_KEY     : z.string().optional(),
    VIASOCKET_ORG_ID         : z.string().optional(),
    VIASOCKET_PROJECT_ID     : z.string().optional(),
    PAUTHKEY:z.string().min(1),
    GTWY_DRAFT_AGENT_ID      : z.string().default('6aa3f0a03e5db27e9a0661e4'),

    // ── Billing ────────────────────────────────────────────────────
    // Optional so the server still boots before Razorpay is set up; the
    // billing routes return 503 until keys are present.
    RAZORPAY_KEY_ID          : z.string().optional(),
    RAZORPAY_KEY_SECRET      : z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET  : z.string().optional(),
    BILLING_MARKUP           : z.coerce.number().default(2),
    BILLING_FX_USD_INR       : z.coerce.number().default(90),
    BILLING_CREDIT_RATE_MICRO: z.coerce.number().default(10000),
    BILLING_MIN_BALANCE_CREDITS: z.coerce.number().default(200),
    BILLING_CREDIT_LABEL     : z.string().default('Tokens'),
    // Set to the string 'false' to meter without blocking anyone.
    BILLING_ENFORCEMENT      : z.string().default('false'),
});

export const config = env.parse(process.env);