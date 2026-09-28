-- 011_case_intelligence.sql
--
-- Foundations for the Case Intelligence layer.
--
-- Written against the live schema as read from production on 28 Sep 2026
-- (10 migrations applied, 001_auth_rbac -> 010_billing).
--
-- Covers:
--   * documents + document_pages   — there was no document record anywhere.
--                                    Nothing could be cited. This is the
--                                    prerequisite for DOCUMENT_SUPPORTED facts.
--   * chat_messages                — chat_threads stored titles only; 144 threads
--                                    existed with every message outside our DB.
--   * parties + case_parties       — replaces cases.client_name / opposing_party,
--                                    two text columns with no contact details and
--                                    a permanent 1-vs-1 assumption.
--   * case_types                   — case_type was unconstrained text.
--   * consultations                — container only; see NOTE at §6.
--   * facts + fact_sources
--     + fact_relations             — the evidentiary core.
--   * audit_log                    — nothing recorded who changed what.
--
-- Conventions copied from the existing schema, not invented:
--   gen_random_uuid() for ids, now() for timestamps,
--   ON DELETE CASCADE for case_id / organisation_id,
--   ON DELETE SET NULL for created_by / assigned_to.
--
-- Idempotent: safe to re-run. Additive only: no column is dropped and no
-- existing row is modified except cases.case_type_id, which starts NULL.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. Enum types
-- ─────────────────────────────────────────────────────────────────────

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'party_kind') THEN
        CREATE TYPE party_kind AS ENUM ('INDIVIDUAL','COMPANY','PARTNERSHIP','TRUST','GOVERNMENT','OTHER');
    END IF;

    -- Deliberately not just CLIENT/OPPONENT. A case has advocates, witnesses and
    -- third parties, and multiple of each.
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'case_party_role') THEN
        CREATE TYPE case_party_role AS ENUM (
            'CLIENT','OPPOSING_PARTY','CLIENT_ADVOCATE','OPPOSING_ADVOCATE',
            'WITNESS','THIRD_PARTY','COURT','OTHER');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_kind') THEN
        CREATE TYPE document_kind AS ENUM (
            'EVIDENCE','PLEADING','ORDER','CONTRACT','CORRESPONDENCE',
            'IDENTITY','FINANCIAL','NOTICE','OTHER');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'processing_status') THEN
        CREATE TYPE processing_status AS ENUM ('PENDING','PROCESSING','READY','FAILED','SKIPPED');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_role') THEN
        CREATE TYPE message_role AS ENUM ('USER','ASSISTANT','SYSTEM','TOOL');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'consultation_mode') THEN
        CREATE TYPE consultation_mode AS ENUM ('IN_PERSON','PHONE','VIDEO','CHAT','OTHER');
    END IF;

    -- The six classes from the brief, verbatim. These must never be collapsed.
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assertion_class') THEN
        CREATE TYPE assertion_class AS ENUM (
            'CLIENT_ALLEGATION','DOCUMENT_SUPPORTED','OPPOSING_POSITION',
            'LAWYER_NOTE','AI_INFERENCE','LEGAL_AUTHORITY');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'evidence_status') THEN
        CREATE TYPE evidence_status AS ENUM (
            'UNSUPPORTED','PARTIALLY_SUPPORTED','SUPPORTED','CONTRADICTED','DISPUTED');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'verification_status') THEN
        CREATE TYPE verification_status AS ENUM (
            'UNVERIFIED','NEEDS_REVIEW','LAWYER_APPROVED','LAWYER_REJECTED');
    END IF;

    -- Clients rarely remember exact dates. Storing "March 2024" as 2024-03-01
    -- and forgetting it was approximate is how a timeline becomes a liability.
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'date_precision') THEN
        CREATE TYPE date_precision AS ENUM ('EXACT','MONTH','QUARTER','YEAR','APPROX','UNKNOWN');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fact_source_kind') THEN
        CREATE TYPE fact_source_kind AS ENUM (
            'DOCUMENT','CONSULTATION','CHAT_MESSAGE','LAWYER_INPUT',
            'OPPOSING_FILING','EXTERNAL_AUTHORITY');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fact_relation_kind') THEN
        CREATE TYPE fact_relation_kind AS ENUM ('SUPPORTS','CONTRADICTS','REFINES','DUPLICATES');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'actor_kind') THEN
        CREATE TYPE actor_kind AS ENUM ('USER','SYSTEM','AI');
    END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Case classification
--
-- organisation_id NULL means a system-provided type available to everyone.
-- Firms can add their own without touching the seeded list.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS case_types (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID REFERENCES organisations(id) ON DELETE CASCADE,
    code            TEXT NOT NULL,
    label           TEXT NOT NULL,
    description     TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 100,
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT case_types_code_format CHECK (code ~ '^[A-Z0-9_]+$')
);

-- Two partial indexes rather than one, because NULL organisation_id would
-- otherwise never collide with itself.
CREATE UNIQUE INDEX IF NOT EXISTS ux_case_types_global
    ON case_types(code) WHERE organisation_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_case_types_org
    ON case_types(organisation_id, code) WHERE organisation_id IS NOT NULL;

INSERT INTO case_types (organisation_id, code, label, sort_order) VALUES
    (NULL,'CIVIL',      'Civil',       10),
    (NULL,'CRIMINAL',   'Criminal',    20),
    (NULL,'CONSUMER',   'Consumer',    30),
    (NULL,'COMMERCIAL', 'Commercial',  40),
    (NULL,'FAMILY',     'Family',      50),
    (NULL,'PROPERTY',   'Property',    60),
    (NULL,'ARBITRATION','Arbitration', 70),
    (NULL,'CORPORATE',  'Corporate',   80),
    (NULL,'OTHER',      'Other',      999)
ON CONFLICT DO NOTHING;

-- cases.case_type (free text) is KEPT. It is backfilled into case_type_id at §9
-- and remains readable until the application stops writing it.
ALTER TABLE cases ADD COLUMN IF NOT EXISTS case_type_id UUID
    REFERENCES case_types(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_cases_case_type ON cases(case_type_id);

-- ─────────────────────────────────────────────────────────────────────
-- 3. Parties
--
-- Scoped to the organisation, not the case, so a repeat client or a
-- frequently-encountered opposing advocate is one row reused across matters.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS parties (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    kind            party_kind NOT NULL DEFAULT 'INDIVIDUAL',
    full_name       TEXT NOT NULL,
    phone           TEXT,
    email           TEXT,
    address         TEXT,
    city            TEXT,
    state           TEXT,
    pincode         TEXT,
    -- Advocates only.
    firm            TEXT,
    bar_council_id  TEXT,
    -- Entities only.
    identifier      TEXT,   -- CIN / GSTIN / PAN as applicable
    notes           TEXT,
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT parties_full_name_not_blank CHECK (btrim(full_name) <> '')
);

CREATE INDEX IF NOT EXISTS ix_parties_org  ON parties(organisation_id);
CREATE INDEX IF NOT EXISTS ix_parties_name ON parties(organisation_id, lower(full_name));

CREATE TABLE IF NOT EXISTS case_parties (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id      UUID NOT NULL REFERENCES cases(id)   ON DELETE CASCADE,
    party_id     UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    role         case_party_role NOT NULL,
    -- An advocate represents a party. Modelling it this way avoids assuming
    -- there are exactly two sides.
    represents_case_party_id UUID REFERENCES case_parties(id) ON DELETE SET NULL,
    is_primary   BOOLEAN NOT NULL DEFAULT FALSE,
    position     INTEGER NOT NULL DEFAULT 1,
    joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT ux_case_parties UNIQUE (case_id, party_id, role)
);

CREATE INDEX IF NOT EXISTS ix_case_parties_case  ON case_parties(case_id, role, position);
CREATE INDEX IF NOT EXISTS ix_case_parties_party ON case_parties(party_id);

-- At most one primary per role per case.
CREATE UNIQUE INDEX IF NOT EXISTS ux_case_parties_primary
    ON case_parties(case_id, role) WHERE is_primary;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Documents
--
-- organisation_id is denormalised so document access can be authorised
-- without a join back through cases on every read.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS documents (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id           UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    organisation_id   UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    title             TEXT NOT NULL,
    description       TEXT,
    kind              document_kind NOT NULL DEFAULT 'OTHER',
    original_filename TEXT,
    mime_type         TEXT,
    byte_size         BIGINT,
    page_count        INTEGER,
    checksum_sha256   TEXT,
    -- Where the bytes live.
    storage_provider  TEXT,
    storage_key       TEXT,
    -- Where the vectors live. Mirrors cases.collection_id.
    kb_collection_id  TEXT,
    kb_resource_id    TEXT,
    ocr_status        processing_status NOT NULL DEFAULT 'PENDING',
    index_status      processing_status NOT NULL DEFAULT 'PENDING',
    index_error       TEXT,
    -- Provenance of the document itself: who produced it, not who uploaded it.
    received_from_case_party_id UUID REFERENCES case_parties(id) ON DELETE SET NULL,
    document_date     DATE,
    uploaded_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Evidence is never hard-deleted; a cited document must remain resolvable.
    deleted_at        TIMESTAMPTZ,
    CONSTRAINT documents_title_not_blank CHECK (btrim(title) <> '')
);

CREATE INDEX IF NOT EXISTS ix_documents_case
    ON documents(case_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_documents_org  ON documents(organisation_id);
CREATE INDEX IF NOT EXISTS ix_documents_kb   ON documents(kb_resource_id) WHERE kb_resource_id IS NOT NULL;

-- Re-uploading the same file to the same case is a mistake, not a second exhibit.
CREATE UNIQUE INDEX IF NOT EXISTS ux_documents_case_checksum
    ON documents(case_id, checksum_sha256)
    WHERE checksum_sha256 IS NOT NULL AND deleted_at IS NULL;

-- The citation anchor. Without page-level text, "page 4 of the invoice"
-- cannot be verified by a human reading the same page.
CREATE TABLE IF NOT EXISTS document_pages (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id  UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_number  INTEGER NOT NULL,
    text_content TEXT,
    char_count   INTEGER,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT document_pages_page_positive CHECK (page_number >= 1),
    CONSTRAINT ux_document_pages UNIQUE (document_id, page_number)
);

-- ─────────────────────────────────────────────────────────────────────
-- 5. Chat message persistence
--
-- gateway_message_id is the Gateway's own stable message id — the same key
-- 010_billing uses for usage idempotency, so a message and its cost can be
-- reconciled.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_messages (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id          UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    case_id            UUID REFERENCES cases(id) ON DELETE CASCADE,
    role               message_role NOT NULL,
    content            TEXT NOT NULL DEFAULT '',
    gateway_message_id TEXT,
    model              TEXT,
    tool_name          TEXT,
    metadata           JSONB,
    created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_chat_messages_thread ON chat_messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS ix_chat_messages_case   ON chat_messages(case_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_chat_messages_gateway
    ON chat_messages(gateway_message_id) WHERE gateway_message_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 6. Consultations
--
-- NOTE: container only. The brief's UPDATE 3 was truncated mid-sentence, so
-- the transcript model (in-browser capture vs upload, diarisation, whether
-- speaker turns are the citable anchor) is deliberately NOT decided here.
-- A fact sourced from a consultation can currently cite the consultation and
-- an optional free-text quote, not a timestamped turn. Adding turn-level
-- anchoring later is additive and does not invalidate anything below.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS consultations (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id           UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    title             TEXT,
    mode              consultation_mode NOT NULL DEFAULT 'IN_PERSON',
    occurred_at       TIMESTAMPTZ NOT NULL,
    duration_seconds  INTEGER,
    notes             TEXT,
    -- The recording, if one exists, is a document like any other.
    audio_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    transcript_status processing_status NOT NULL DEFAULT 'SKIPPED',
    transcript_text   TEXT,
    recorded_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_consultations_case ON consultations(case_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS consultation_attendees (
    consultation_id UUID NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
    case_party_id   UUID NOT NULL REFERENCES case_parties(id) ON DELETE CASCADE,
    PRIMARY KEY (consultation_id, case_party_id)
);

-- ─────────────────────────────────────────────────────────────────────
-- 7. Facts
--
-- assertion_class is the load-bearing column. It is NOT NULL and has no
-- default on purpose: every writer must state what kind of claim this is.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS facts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id             UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    statement           TEXT NOT NULL,
    assertion_class     assertion_class NOT NULL,
    evidence_status     evidence_status NOT NULL DEFAULT 'UNSUPPORTED',
    verification_status verification_status NOT NULL DEFAULT 'UNVERIFIED',

    -- Which case party the statement is about / attributed to.
    about_case_party_id UUID REFERENCES case_parties(id) ON DELETE SET NULL,
    asserted_by_case_party_id UUID REFERENCES case_parties(id) ON DELETE SET NULL,

    event_date          DATE,
    event_date_precision date_precision NOT NULL DEFAULT 'UNKNOWN',
    event_end_date      DATE,

    confidence          NUMERIC(3,2),
    is_ai_generated     BOOLEAN NOT NULL DEFAULT FALSE,

    -- Facts are superseded, not edited away. The old row stays citable.
    supersedes_fact_id  UUID REFERENCES facts(id) ON DELETE SET NULL,

    created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,

    CONSTRAINT facts_statement_not_blank CHECK (btrim(statement) <> ''),
    CONSTRAINT facts_confidence_range CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    CONSTRAINT facts_dates_ordered CHECK (event_end_date IS NULL OR event_date IS NULL OR event_end_date >= event_date),
    -- An approval must record who and when, or neither.
    CONSTRAINT facts_approval_complete CHECK (
        (verification_status IN ('LAWYER_APPROVED','LAWYER_REJECTED'))
            = (approved_by IS NOT NULL AND approved_at IS NOT NULL)
    ),
    -- An AI inference cannot claim to be a documented fact by itself; if a
    -- document supports it, the class becomes DOCUMENT_SUPPORTED and §7.1 applies.
    CONSTRAINT facts_ai_not_authority CHECK (
        NOT (is_ai_generated AND assertion_class = 'LEGAL_AUTHORITY')
    ),
    CONSTRAINT facts_no_self_supersede CHECK (supersedes_fact_id IS NULL OR supersedes_fact_id <> id)
);

CREATE INDEX IF NOT EXISTS ix_facts_case
    ON facts(case_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_facts_case_class
    ON facts(case_id, assertion_class) WHERE deleted_at IS NULL;
-- Timeline reads.
CREATE INDEX IF NOT EXISTS ix_facts_case_event_date
    ON facts(case_id, event_date) WHERE deleted_at IS NULL AND event_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_facts_needs_review
    ON facts(case_id) WHERE deleted_at IS NULL AND verification_status IN ('UNVERIFIED','NEEDS_REVIEW');

-- Provenance. A fact may rest on several sources.
CREATE TABLE IF NOT EXISTS fact_sources (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fact_id         UUID NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
    source_kind     fact_source_kind NOT NULL,

    document_id     UUID REFERENCES documents(id)      ON DELETE RESTRICT,
    document_page   INTEGER,
    consultation_id UUID REFERENCES consultations(id)  ON DELETE SET NULL,
    chat_message_id UUID REFERENCES chat_messages(id)  ON DELETE SET NULL,

    -- Verbatim support. What a human checks the citation against.
    quote           TEXT,
    char_start      INTEGER,
    char_end        INTEGER,

    authority_citation TEXT,
    authority_url      TEXT,

    note            TEXT,
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- The referenced id must match the declared kind. Without this a row can
    -- claim DOCUMENT and point at nothing.
    CONSTRAINT fact_sources_shape CHECK (
        (source_kind = 'DOCUMENT'           AND document_id     IS NOT NULL) OR
        (source_kind = 'CONSULTATION'       AND consultation_id IS NOT NULL) OR
        (source_kind = 'CHAT_MESSAGE'       AND chat_message_id IS NOT NULL) OR
        (source_kind = 'EXTERNAL_AUTHORITY' AND authority_citation IS NOT NULL) OR
        (source_kind IN ('LAWYER_INPUT','OPPOSING_FILING'))
    ),
    CONSTRAINT fact_sources_page_positive CHECK (document_page IS NULL OR document_page >= 1),
    CONSTRAINT fact_sources_span_ordered CHECK (char_end IS NULL OR char_start IS NULL OR char_end >= char_start)
);

CREATE INDEX IF NOT EXISTS ix_fact_sources_fact ON fact_sources(fact_id);
CREATE INDEX IF NOT EXISTS ix_fact_sources_doc  ON fact_sources(document_id) WHERE document_id IS NOT NULL;

-- Contradiction between the client's account and the other side's is the
-- normal state of a case, not an error. It needs to be representable.
CREATE TABLE IF NOT EXISTS fact_relations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_fact_id UUID NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
    to_fact_id   UUID NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
    relation     fact_relation_kind NOT NULL,
    note         TEXT,
    created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fact_relations_distinct CHECK (from_fact_id <> to_fact_id),
    CONSTRAINT ux_fact_relations UNIQUE (from_fact_id, to_fact_id, relation)
);

CREATE INDEX IF NOT EXISTS ix_fact_relations_to ON fact_relations(to_fact_id);

-- ─────────────────────────────────────────────────────────────────────
-- 7.1 The rule the schema exists to enforce
--
-- A fact classed DOCUMENT_SUPPORTED must actually have a document behind it.
-- A CHECK constraint cannot see other tables, so this is a deferred constraint
-- trigger: it fires at COMMIT, which means the fact and its source can be
-- inserted in either order within one transaction.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION assert_document_supported_has_document() RETURNS TRIGGER AS $$
DECLARE
    target UUID;
    cls    assertion_class;
    gone   BOOLEAN;
BEGIN
    -- One function, two tables. The record layouts differ, so the branch must be
    -- a statement and not a CASE expression: plpgsql resolves OLD.fact_id even
    -- on the untaken arm, and that column does not exist on `facts`.
    IF TG_TABLE_NAME = 'fact_sources' THEN
        target := OLD.fact_id;
    ELSE
        target := NEW.id;
    END IF;

    SELECT f.assertion_class, (f.deleted_at IS NOT NULL)
      INTO cls, gone
      FROM facts f WHERE f.id = target;

    -- Parent already removed, or soft-deleted: nothing to assert.
    IF NOT FOUND OR gone THEN
        RETURN NULL;
    END IF;

    IF cls = 'DOCUMENT_SUPPORTED' AND NOT EXISTS (
        SELECT 1 FROM fact_sources s
         WHERE s.fact_id = target
           AND s.source_kind = 'DOCUMENT'
           AND s.document_id IS NOT NULL
    ) THEN
        RAISE EXCEPTION
            'fact % is classed DOCUMENT_SUPPORTED but has no document source', target
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_facts_document_support ON facts;
CREATE CONSTRAINT TRIGGER trg_facts_document_support
    AFTER INSERT OR UPDATE ON facts
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_document_supported_has_document();

-- Removing the last supporting document must not silently leave the claim standing.
DROP TRIGGER IF EXISTS trg_fact_sources_document_support ON fact_sources;
CREATE CONSTRAINT TRIGGER trg_fact_sources_document_support
    AFTER DELETE ON fact_sources
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_document_supported_has_document();

-- ─────────────────────────────────────────────────────────────────────
-- 8. Audit log
--
-- BIGSERIAL, not UUID: this table grows faster than everything else combined
-- and is only ever read by range.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
    id              BIGSERIAL PRIMARY KEY,
    organisation_id UUID REFERENCES organisations(id) ON DELETE CASCADE,
    case_id         UUID REFERENCES cases(id) ON DELETE CASCADE,
    actor_kind      actor_kind NOT NULL DEFAULT 'USER',
    actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    action          TEXT NOT NULL,          -- e.g. 'fact.approved', 'document.deleted'
    entity_type     TEXT NOT NULL,
    entity_id       UUID,
    before_state    JSONB,
    after_state     JSONB,
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT audit_log_actor_consistent CHECK (
        actor_kind <> 'USER' OR actor_user_id IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS ix_audit_case   ON audit_log(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_org    ON audit_log(organisation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_entity ON audit_log(entity_type, entity_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 9. Backfill
--
-- Idempotent by construction: a case that already has a party in a role is
-- skipped, so re-running produces no duplicates.
-- ─────────────────────────────────────────────────────────────────────

-- 9a. cases.case_type (free text) -> case_types
UPDATE cases c
   SET case_type_id = t.id
  FROM case_types t
 WHERE t.organisation_id IS NULL
   AND c.case_type_id IS NULL
   AND c.case_type IS NOT NULL
   AND upper(btrim(c.case_type)) IN (t.code, upper(t.label));

-- 9b. cases.client_name -> parties + case_parties(CLIENT)
--
-- The party id is generated in the CTE rather than joined back on
-- (organisation_id, full_name). Two cases in one firm with the same client
-- name are common, and joining on name would pair every such case with every
-- such new party — producing duplicate CLIENT rows and tripping
-- ux_case_parties_primary. Generating the id up front keeps it strictly 1:1.
-- Deduplicating repeat clients into a single party is a separate, reviewable
-- exercise; a migration should not silently merge two people who share a name.
WITH candidate AS (
    SELECT c.id AS case_id,
           c.organisation_id,
           btrim(c.client_name) AS nm,
           gen_random_uuid()    AS party_id
      FROM cases c
     WHERE c.client_name IS NOT NULL
       AND btrim(c.client_name) <> ''
       AND NOT EXISTS (
           SELECT 1 FROM case_parties cp
            WHERE cp.case_id = c.id AND cp.role = 'CLIENT')
), inserted AS (
    INSERT INTO parties (id, organisation_id, kind, full_name, notes)
    SELECT party_id, organisation_id, 'INDIVIDUAL', nm,
           'Backfilled from cases.client_name (011)'
      FROM candidate
    RETURNING id
)
INSERT INTO case_parties (case_id, party_id, role, is_primary, position)
SELECT case_id, party_id, 'CLIENT', TRUE, 1 FROM candidate
ON CONFLICT DO NOTHING;

-- 9c. cases.opposing_party -> parties + case_parties(OPPOSING_PARTY)
--
-- kind is OTHER, not INDIVIDUAL: an opposing party free-text field holds
-- company names as often as people's, and guessing wrong is worse than
-- recording that we do not know.
WITH candidate AS (
    SELECT c.id AS case_id,
           c.organisation_id,
           btrim(c.opposing_party) AS nm,
           gen_random_uuid()       AS party_id
      FROM cases c
     WHERE c.opposing_party IS NOT NULL
       AND btrim(c.opposing_party) <> ''
       AND NOT EXISTS (
           SELECT 1 FROM case_parties cp
            WHERE cp.case_id = c.id AND cp.role = 'OPPOSING_PARTY')
), inserted AS (
    INSERT INTO parties (id, organisation_id, kind, full_name, notes)
    SELECT party_id, organisation_id, 'OTHER', nm,
           'Backfilled from cases.opposing_party (011)'
      FROM candidate
    RETURNING id
)
INSERT INTO case_parties (case_id, party_id, role, is_primary, position)
SELECT case_id, party_id, 'OPPOSING_PARTY', TRUE, 1 FROM candidate
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 10. Read helper
--
-- Every surface that renders a fact needs the class and the support count
-- together. Putting it in one view keeps callers from forgetting the class.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_case_facts AS
SELECT
    f.id,
    f.case_id,
    f.statement,
    f.assertion_class,
    f.evidence_status,
    f.verification_status,
    f.event_date,
    f.event_date_precision,
    f.is_ai_generated,
    f.confidence,
    COUNT(s.id) FILTER (WHERE s.source_kind = 'DOCUMENT')     AS document_source_count,
    COUNT(s.id) FILTER (WHERE s.source_kind = 'CONSULTATION') AS consultation_source_count,
    COUNT(s.id)                                               AS total_source_count,
    f.created_at,
    f.updated_at
  FROM facts f
  LEFT JOIN fact_sources s ON s.fact_id = f.id
 WHERE f.deleted_at IS NULL
 GROUP BY f.id;

COMMIT;
