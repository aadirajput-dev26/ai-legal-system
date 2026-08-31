-- Migration 007: UI Alignment Fields
-- Add missing fields to cases to support the new UI metadata
-- Create tasks table

ALTER TABLE cases
ADD COLUMN IF NOT EXISTS stage TEXT,
ADD COLUMN IF NOT EXISTS judge TEXT,
ADD COLUMN IF NOT EXISTS client_name TEXT,
ADD COLUMN IF NOT EXISTS opposing_party TEXT;

-- Create a new tasks table
DO $$ BEGIN
    CREATE TYPE task_status AS ENUM ('PENDING', 'COMPLETED', 'OVERDUE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS tasks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id     UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT,
    status      task_status NOT NULL DEFAULT 'PENDING',
    due_date    TIMESTAMPTZ,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
