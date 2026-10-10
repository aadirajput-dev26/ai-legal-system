-- Migration 013: Convert draft_type from ENUM to VARCHAR
-- Converts the existing draft_type enum to a string to allow dynamic draft types.

ALTER TABLE drafts ALTER COLUMN draft_type DROP DEFAULT;
ALTER TABLE drafts ALTER COLUMN draft_type TYPE VARCHAR(255) USING draft_type::text;
ALTER TABLE drafts ALTER COLUMN draft_type SET DEFAULT 'OTHER';
