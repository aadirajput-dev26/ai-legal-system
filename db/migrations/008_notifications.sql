-- Migration 008: Notifications & Alerts Table

CREATE TABLE IF NOT EXISTS notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    case_id         UUID REFERENCES cases(id) ON DELETE CASCADE,
    title           VARCHAR(255) NOT NULL,
    message         TEXT NOT NULL,
    type            VARCHAR(50) NOT NULL DEFAULT 'SYSTEM', -- 'HEARING_ALERT', 'TASK_DUE', 'CASE_UPDATE', 'AI_INSIGHT', 'SYSTEM'
    priority        VARCHAR(20) NOT NULL DEFAULT 'NORMAL',  -- 'URGENT', 'HIGH', 'NORMAL', 'LOW'
    link            VARCHAR(255),
    is_read         BOOLEAN NOT NULL DEFAULT FALSE,
    read_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_notifications_user_org_read 
    ON notifications(user_id, organisation_id, is_read);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at 
    ON notifications(created_at DESC);
