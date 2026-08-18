-- Migration 001: Auth & RBAC base schema
-- Run this file against your PostgreSQL database before starting the server.

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────
-- 1. users
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL,
    email        TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    avatar       TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 2. organisations
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organisations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 3. organisation_members
-- ─────────────────────────────────────────────
CREATE TYPE org_role AS ENUM ('ADMIN', 'EDITOR', 'VIEWER');

CREATE TABLE IF NOT EXISTS organisation_members (
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            org_role NOT NULL DEFAULT 'VIEWER',
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organisation_id, user_id)
);

-- ─────────────────────────────────────────────
-- 4. cases (stub — just the RBAC-essential columns)
-- ─────────────────────────────────────────────
CREATE TYPE case_status AS ENUM ('OPEN', 'CLOSED', 'ARCHIVED');

CREATE TABLE IF NOT EXISTS cases (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    collection_id   TEXT,           -- Hippocampus collection ID (set after RAG provisioning)
    title           TEXT NOT NULL,
    description     TEXT,
    case_number     TEXT,
    court           TEXT,
    case_type       TEXT,
    status          case_status NOT NULL DEFAULT 'OPEN',
    filing_date     DATE,
    next_hearing_date TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 5. case_members
-- ─────────────────────────────────────────────
CREATE TYPE case_role AS ENUM ('ADMIN', 'EDITOR', 'VIEWER');

CREATE TABLE IF NOT EXISTS case_members (
    case_id   UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role      case_role NOT NULL DEFAULT 'VIEWER',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (case_id, user_id)
);
