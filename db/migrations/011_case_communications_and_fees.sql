-- 1. Extend cases table with single structured JSONB column
ALTER TABLE cases 
  ADD COLUMN IF NOT EXISTS contact_details JSONB DEFAULT '{}'::jsonb;

-- 2. Case Fee Tracker Table (Agreed total fee + stage breakdown + payment history)
CREATE TABLE IF NOT EXISTS case_fee_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    total_agreed_fee NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total_received NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    outstanding_balance NUMERIC(12,2) GENERATED ALWAYS AS (total_agreed_fee - total_received) STORED,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS case_fee_milestones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    stage_name VARCHAR(100) NOT NULL, -- e.g. 'Filing Stage', 'Hearing Stage', 'Argument Stage'
    amount NUMERIC(12,2) NOT NULL,
    due_date DATE,
    status VARCHAR(50) DEFAULT 'PENDING', -- 'PENDING', 'PAID'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS case_fee_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    milestone_id UUID REFERENCES case_fee_milestones(id) ON DELETE SET NULL,
    amount_paid NUMERIC(12,2) NOT NULL,
    payment_mode VARCHAR(50) DEFAULT 'BANK_TRANSFER',
    receipt_number VARCHAR(100),
    payment_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
);

-- 3. Case Communication Audit Log Table
CREATE TABLE IF NOT EXISTS case_communications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    sender_user_id UUID REFERENCES users(id),
    recipient_email VARCHAR(255) NOT NULL,
    recipient_role VARCHAR(50) NOT NULL, -- 'CLIENT', 'OPPONENT_ADVOCATE', 'OPPONENT'
    template_key VARCHAR(100) NOT NULL, -- e.g. 'COURT_DOCUMENT_SERVED', 'FEE_RECEIPT'
    document_resource_id VARCHAR(255),
    status VARCHAR(50) DEFAULT 'SENT',
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Fast case lookup & contact GIN index for JSON queries
CREATE INDEX IF NOT EXISTS idx_cases_contact_details ON cases USING gin (contact_details);

-- Fast lookup for Case Fees and Milestones
CREATE INDEX IF NOT EXISTS idx_case_fee_schedules_case_id ON case_fee_schedules(case_id);
CREATE INDEX IF NOT EXISTS idx_case_fee_milestones_case_id ON case_fee_milestones(case_id);
CREATE INDEX IF NOT EXISTS idx_case_fee_payments_case_id ON case_fee_payments(case_id);

-- Fast lookup for Case Communication history
CREATE INDEX IF NOT EXISTS idx_case_communications_case_id ON case_communications(case_id);
