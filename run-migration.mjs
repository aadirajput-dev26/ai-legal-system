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

    // Create tracking table if it doesn't exist
    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            name TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    // Fetch already applied migrations
    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map(r => r.name));

    const migrationsDir = resolve(__dirname, 'db/migrations');
    const files = readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();

    for (const file of files) {
        if (applied.has(file)) {
            console.log(`Skipping migration: ${file} (already applied)`);
            continue;
        }

        console.log(`Running migration: ${file}...`);
        const sql = readFileSync(resolve(migrationsDir, file), 'utf-8');
        
        // Wrap each migration file in a transaction
        await client.query('BEGIN');
        try {
            await client.query(sql);
            await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
            await client.query('COMMIT');
            console.log(`✅ Applied ${file} successfully`);
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
    }

    await client.end();
}

main().catch((err) => {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
});
