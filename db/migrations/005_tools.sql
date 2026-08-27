-- Migration 005: Viasocket Tools
-- Stores tool metadata synced from the Viasocket widget via postMessage events.

CREATE TABLE IF NOT EXISTS tools (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id       UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    script_id     TEXT NOT NULL,          -- Viasocket script/tool ID
    title         TEXT NOT NULL,
    description   TEXT,
    webhook_url   TEXT,                   -- Viasocket webhook callback URL
    openai_tool_json JSONB,              -- OpenAI-compatible tool/function JSON schema
    created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (case_id, script_id)
);

CREATE INDEX IF NOT EXISTS idx_tools_case_id ON tools (case_id);
CREATE INDEX IF NOT EXISTS idx_tools_script_id ON tools (script_id);
