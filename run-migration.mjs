#!/usr/bin/env node
/**
 * run-migration.mjs
 * Runs db/migrations/001_auth_rbac.sql against your PostgreSQL database.
 * Uses DATABASE_URL from .env
 *
 * Run with:  node run-migration.mjs
 */

import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { config as dotenv } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv();

const { Client } = pg;

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function main() {
    await client.connect();
    console.log('✅ Connected to database');

    const migrationsDir = resolve(__dirname, 'db/migrations');
    const files = readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();

    for (const file of files) {
        console.log(`Running migration: ${file}...`);
        const sql = readFileSync(resolve(migrationsDir, file), 'utf-8');
        await client.query(sql);
        console.log(`✅ Applied ${file} successfully`);
    }

    await client.end();
}

main().catch((err) => {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
});
