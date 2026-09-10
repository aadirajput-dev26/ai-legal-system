-- Migration 009: AI Case-Specific Draft Generation
-- Stores lawyer drafts (AI-generated and manually edited) with full version history.

CREATE TYPE draft_type AS ENUM (
    'LEGAL_NOTICE',
    'APPLICATION',
    'AFFIDAVIT',
    'REPLY',
    'EMAIL',
    'WHATSAPP',
    'COURT_DRAFT',
    'CORRESPONDENCE',
    'OTHER'
);

CREATE TYPE draft_status AS ENUM (
    'DRAFT',
    'IN_REVIEW',
    'APPROVED'
);

CREATE TABLE IF NOT EXISTS drafts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id         UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    description     TEXT,
    draft_type      draft_type NOT NULL DEFAULT 'OTHER',
    status          draft_status NOT NULL DEFAULT 'DRAFT',
    instructions    TEXT,                            -- Lawyer's custom instructions for AI generation
    current_content TEXT NOT NULL DEFAULT '',        -- Live editable content (Markdown)
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lightweight version history: snapshots are created on generation and AI refinements
-- so lawyers can revert if an AI edit produced undesirable output.
CREATE TABLE IF NOT EXISTS draft_versions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    draft_id        UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
    version_number  INTEGER NOT NULL,
    content         TEXT NOT NULL,
    change_type     TEXT NOT NULL CHECK (change_type IN ('AI_GENERATION', 'AI_REFINEMENT', 'MANUAL_SAVE')),
    prompt_used     TEXT,                            -- The AI prompt that triggered this version
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drafts_case_id ON drafts (case_id);
CREATE INDEX IF NOT EXISTS idx_drafts_status  ON drafts (status);
CREATE INDEX IF NOT EXISTS idx_draft_versions_draft_id ON draft_versions (draft_id);
