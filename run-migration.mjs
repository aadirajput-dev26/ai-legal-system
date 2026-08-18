#!/usr/bin/env node
/**
 * run-migration.mjs
 * Runs db/migrations/001_auth_rbac.sql against your PostgreSQL database.
 * Uses DATABASE_URL from .env
 *
 * Run with:  node run-migration.mjs
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { config as dotenv } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv();

const { Client } = pg;

const sql = readFileSync(resolve(__dirname, 'db/migrations/001_auth_rbac.sql'), 'utf-8');

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function main() {
    await client.connect();
    console.log('✅ Connected to database');
    await client.query(sql);
    console.log('✅ Migration 001_auth_rbac applied successfully');
    await client.end();
}

main().catch((err) => {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
});
