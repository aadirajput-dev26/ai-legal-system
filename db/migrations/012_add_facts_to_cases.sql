-- Migration 012: Add facts column to cases table
ALTER TABLE cases
ADD COLUMN facts TEXT;
