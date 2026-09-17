-- ════════════════════════════════════════════════════════════════════
-- 010_billing.sql — Usage metering, credits, subscriptions, payments.
--
-- MONEY AND CREDITS ARE INTEGER MICRO-UNITS. NEVER FLOAT.
--   *_micro on money   = millionths of INR   (1_000_000 = ₹1)
--   *_micro on credits = millionths of 1 credit
--   1 credit           = ₹0.01 of customer usage value (see billing-config.ts)
--
-- Balance is ALWAYS derived from credit_ledger. billing_periods carries a
-- denormalised counter for fast reads, written in the same transaction.
-- ════════════════════════════════════════════════════════════════════

-- ── Plans ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plans (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                TEXT UNIQUE NOT NULL,
    name                TEXT NOT NULL,
    description         TEXT,
    razorpay_plan_id    TEXT UNIQUE,
    price_micro         BIGINT NOT NULL,              -- ₹1,799 → 1799000000
    currency            CHAR(3) NOT NULL DEFAULT 'INR',
    interval            TEXT NOT NULL DEFAULT 'monthly',
    included_credits    BIGINT NOT NULL,
    seat_limit          INTEGER,
    rollover_policy     TEXT NOT NULL DEFAULT 'EXPIRE',   -- EXPIRE | FULL | CAPPED
    rollover_cap_credits BIGINT,
    overage_policy      TEXT NOT NULL DEFAULT 'TOPUP',    -- BLOCK | TOPUP | ALLOW
    features            JSONB NOT NULL DEFAULT '{}',
    sort_order          INTEGER NOT NULL DEFAULT 0,
    active              BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Top-up packs (pay as you go) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_packs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    price_micro BIGINT NOT NULL,
    credits     BIGINT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    active      BOOLEAN NOT NULL DEFAULT true
);

-- ── Subscriptions ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    plan_id                  UUID NOT NULL REFERENCES plans(id),
    razorpay_subscription_id TEXT UNIQUE,
    razorpay_customer_id     TEXT,
    -- Mirrors Razorpay verbatim. NEVER set from the frontend.
    status                   TEXT NOT NULL DEFAULT 'created',
    current_period_start     TIMESTAMPTZ,
    current_period_end       TIMESTAMPTZ,
    cancel_at_period_end     BOOLEAN NOT NULL DEFAULT false,
    auto_topup_enabled       BOOLEAN NOT NULL DEFAULT false,
    auto_topup_pack_id       UUID REFERENCES credit_packs(id),
    created_by               UUID REFERENCES users(id),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One live subscription per organisation.
CREATE UNIQUE INDEX IF NOT EXISTS ux_sub_org_live ON subscriptions(organisation_id)
    WHERE status IN ('created','authenticated','active','pending','halted');

-- ── Billing periods ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_periods (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id         UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    subscription_id         UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
    period_start            TIMESTAMPTZ NOT NULL,
    period_end              TIMESTAMPTZ NOT NULL,
    allocated_credits       BIGINT NOT NULL DEFAULT 0,
    rolled_over_credits     BIGINT NOT NULL DEFAULT 0,
    topped_up_credits       BIGINT NOT NULL DEFAULT 0,
    consumed_credits_micro  BIGINT NOT NULL DEFAULT 0,
    status                  TEXT NOT NULL DEFAULT 'OPEN',   -- OPEN | CLOSED
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_period_org_start
    ON billing_periods(organisation_id, period_start);
CREATE INDEX IF NOT EXISTS ix_period_org_open
    ON billing_periods(organisation_id) WHERE status = 'OPEN';

-- ── Usage events — immutable, one row per billable operation ─────────
CREATE TABLE IF NOT EXISTS usage_events (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id         UUID REFERENCES organisations(id) ON DELETE SET NULL,
    user_id                 UUID REFERENCES users(id) ON DELETE SET NULL,
    case_id                 UUID REFERENCES cases(id) ON DELETE SET NULL,
    billing_period_id       UUID REFERENCES billing_periods(id) ON DELETE SET NULL,

    feature                 TEXT NOT NULL,   -- AI_CHAT | DRAFT_GENERATE | DRAFT_REFINE
                                             -- | DOC_OCR | DOC_INDEX | DOC_REINDEX | TOOL_RUN
    resource_id             TEXT,            -- thread id, draft id, gtwy resource id

    -- provenance, straight from the Gateway
    provider                TEXT,            -- start.service    e.g. 'openai'
    model                   TEXT,            -- start.model      e.g. 'gpt-5-nano'
    agent_id                TEXT,            -- start.bridge_id
    gateway_message_id      TEXT,            -- done.message_id — THE idempotency key
    request_id              TEXT,

    -- usage, named exactly as the Gateway names it.
    -- input_tokens ALREADY INCLUDES cached_tokens. Never add them.
    input_tokens            INTEGER,
    output_tokens           INTEGER,
    cached_tokens           INTEGER,
    reasoning_tokens        INTEGER,
    total_tokens            INTEGER,
    units                   NUMERIC(14,4),   -- pages, chunks, tool runs
    unit_kind               TEXT,

    -- money — every rate SNAPSHOTTED so history never re-prices
    gateway_cost_usd        NUMERIC(18,10),
    fx_usd_inr              NUMERIC(10,4) NOT NULL,
    underlying_cost_micro   BIGINT NOT NULL DEFAULT 0,
    markup_multiplier       NUMERIC(6,3) NOT NULL,
    customer_value_micro    BIGINT NOT NULL DEFAULT 0,
    credit_rate_micro       BIGINT NOT NULL,          -- micro-INR per 1 credit
    credits_consumed_micro  BIGINT NOT NULL DEFAULT 0,
    currency                CHAR(3) NOT NULL DEFAULT 'INR',

    status                  TEXT NOT NULL DEFAULT 'COMPLETED',
        -- COMPLETED | FAILED | CANCELLED | REFUNDED | UNMETERED
    latency_ms              INTEGER,
    metadata                JSONB NOT NULL DEFAULT '{}',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A retried request that the Gateway did not re-run cannot be charged twice.
CREATE UNIQUE INDEX IF NOT EXISTS ux_usage_gateway_msg
    ON usage_events(gateway_message_id) WHERE gateway_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_usage_org_time   ON usage_events(organisation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_usage_feature    ON usage_events(organisation_id, feature, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_usage_case       ON usage_events(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_usage_user       ON usage_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_usage_period     ON usage_events(billing_period_id);

-- ── Credit ledger — the balance IS this table ────────────────────────
CREATE TABLE IF NOT EXISTS credit_ledger (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id      UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    billing_period_id    UUID REFERENCES billing_periods(id) ON DELETE SET NULL,
    entry_type           TEXT NOT NULL,
        -- ALLOCATION | CONSUMPTION | TOPUP | REFUND | ROLLOVER | EXPIRY | ADJUSTMENT
    delta_credits_micro  BIGINT NOT NULL,        -- signed: consumption is negative
    balance_after_micro  BIGINT NOT NULL,
    usage_event_id       UUID REFERENCES usage_events(id) ON DELETE SET NULL,
    payment_id           UUID,
    idempotency_key      TEXT,
    reason               TEXT,
    created_by           UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ledger_idem
    ON credit_ledger(idempotency_key) WHERE idempotency_key IS NOT NULL;
-- One consumption entry per usage event, ever.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ledger_usage
    ON credit_ledger(usage_event_id) WHERE usage_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ledger_org_time ON credit_ledger(organisation_id, created_at DESC);

-- ── Payments ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id         UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    subscription_id         UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
    kind                    TEXT NOT NULL,      -- SUBSCRIPTION | TOPUP
    credit_pack_id          UUID REFERENCES credit_packs(id),
    razorpay_order_id       TEXT,
    razorpay_payment_id     TEXT UNIQUE,
    razorpay_invoice_id     TEXT,
    amount_micro            BIGINT NOT NULL,
    currency                CHAR(3) NOT NULL DEFAULT 'INR',
    status                  TEXT NOT NULL DEFAULT 'created',
    method                  TEXT,
    credits_granted         BIGINT NOT NULL DEFAULT 0,
    captured_at             TIMESTAMPTZ,
    raw                     JSONB NOT NULL DEFAULT '{}',
    created_by              UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_payments_org ON payments(organisation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_payments_order ON payments(razorpay_order_id);

-- ── Webhook inbox — insert first, process second ─────────────────────
CREATE TABLE IF NOT EXISTS webhook_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider        TEXT NOT NULL DEFAULT 'razorpay',
    event_id        TEXT NOT NULL,
    event_type      TEXT NOT NULL,
    payload         JSONB NOT NULL,
    signature_valid BOOLEAN NOT NULL DEFAULT false,
    processed_at    TIMESTAMPTZ,
    error           TEXT,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_webhook_event ON webhook_events(provider, event_id);

-- ── Seed: one plan, three top-up packs ───────────────────────────────
-- ₹1,799/month ≈ $20. 50,000 credits = ₹500 of usage value.
-- At the measured ~₹0.20 customer value per AI operation that is ~2,500
-- operations a month — deliberately generous. Tune in the DB, not in code.
INSERT INTO plans (code, name, description, price_micro, included_credits,
                   seat_limit, rollover_policy, rollover_cap_credits,
                   overage_policy, sort_order)
VALUES ('PRO', 'LegalDesk Professional',
        'Full platform access for one advocate, with 50,000 AI credits each month.',
        1799000000, 50000, 1, 'CAPPED', 50000, 'TOPUP', 10)
ON CONFLICT (code) DO NOTHING;

INSERT INTO credit_packs (code, name, price_micro, credits, sort_order) VALUES
    ('TOPUP_500',  '50,000 credits',  500000000,   50000, 10),
    ('TOPUP_1000', '100,000 credits', 1000000000, 100000, 20),
    ('TOPUP_2500', '250,000 credits', 2500000000, 250000, 30)
ON CONFLICT (code) DO NOTHING;
