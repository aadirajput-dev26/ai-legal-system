-- Migration 006: Index for cross-case tool lookups
CREATE INDEX IF NOT EXISTS idx_tools_case_script ON tools (case_id, script_id);
