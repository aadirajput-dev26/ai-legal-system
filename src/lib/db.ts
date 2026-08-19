import { Pool } from 'pg';
import { config } from './config.js';

/**
 * db.ts — Singleton PostgreSQL connection pool.
 *
 * Why a pool?
 * - A Pool reuses connections instead of creating a new TCP handshake per query.
 * - Concurrent requests share the pool rather than each opening their own connection.
 * - Idle connections are automatically returned and cleaned up.
 *
 * Why not use req.server.pg everywhere?
 * - req.server.pg is convenient inside route handlers but inaccessible in
 *   non-Fastify contexts (services, middleware, background workers, migration scripts).
 * - Centralising the pool here makes the DB layer framework-agnostic and testable.
 */


const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max             : 20,   // maximum pool connections
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
    console.error('Unexpected PostgreSQL pool error:', err);
});

export default pool;
