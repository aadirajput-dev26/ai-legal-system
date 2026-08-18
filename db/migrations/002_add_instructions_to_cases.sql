-- Migration 002: Add instructions column to cases table
ALTER TABLE cases ADD COLUMN IF NOT EXISTS instructions TEXT;
