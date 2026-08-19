-- Migration 004: Add notification stage flags to hearings
-- These flags track which of the 3 notification stages have been dispatched
-- for each hearing, preventing duplicate sends.

ALTER TABLE hearings
    ADD COLUMN IF NOT EXISTS notified_immediately BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS notified_24h         BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS notified_1h          BOOLEAN NOT NULL DEFAULT FALSE;
