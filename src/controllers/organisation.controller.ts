import { FastifyRequest, FastifyReply } from 'fastify';
import pool from '../lib/db.js';

// ─────────────────────────────────────────────
// GET /api/v1/organisations
// Lists all organisations the current user belongs to
// ─────────────────────────────────────────────
export async function listOrganisations(req: FastifyRequest, reply: FastifyReply) {
    const { userId } = req.user;

    const result = await pool.query<{
        id: string; name: string; description: string | null;
        created_at: string; role: string;
    }>(
        `SELECT o.id, o.name, o.description, o.created_at, om.role
         FROM organisations o
         JOIN organisation_members om ON om.organisation_id = o.id
         WHERE om.user_id = $1
         ORDER BY o.created_at DESC`,
        [userId]
    );

    return reply.code(200).send({ success: true, data: result.rows });
}

// ─────────────────────────────────────────────
// POST /api/v1/organisations
// Creates a new organisation and assigns creator as ADMIN
// ─────────────────────────────────────────────
interface CreateOrgBody { name: string; description?: string; }

export async function createOrganisation(req: FastifyRequest, reply: FastifyReply) {
    const { name, description } = req.body as CreateOrgBody;
    const { userId } = req.user;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const orgResult = await client.query<{ id: string; name: string; description: string | null; created_at: string }>(
            `INSERT INTO organisations (name, description)
             VALUES ($1, $2)
             RETURNING id, name, description, created_at`,
            [name, description ?? null]
        );
        const org = orgResult.rows[0];

        // Creator automatically becomes ADMIN
        await client.query(
            `INSERT INTO organisation_members (organisation_id, user_id, role)
             VALUES ($1, $2, 'ADMIN')`,
            [org.id, userId]
        );

        await client.query('COMMIT');
        return reply.code(201).send({ success: true, data: org });
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// ─────────────────────────────────────────────
// GET /api/v1/organisations/:id
// ─────────────────────────────────────────────
export async function getOrganisation(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };

    const result = await pool.query<{
        id: string; name: string; description: string | null;
        created_at: string; updated_at: string;
    }>(
        'SELECT id, name, description, created_at, updated_at FROM organisations WHERE id = $1',
        [id]
    );

    if (!result.rows[0]) {
        return reply.code(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Organisation not found.' },
        });
    }

    return reply.code(200).send({ success: true, data: result.rows[0] });
}

// ─────────────────────────────────────────────
// PATCH /api/v1/organisations/:id
// Update organisation name/description (ADMIN only)
// ─────────────────────────────────────────────
interface UpdateOrgBody { name?: string; description?: string; }

export async function updateOrganisation(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };
    const body = req.body as UpdateOrgBody;

    const fields: string[]  = [];
    const values: unknown[] = [];
    let idx = 1;

    if (body.name        != null) { fields.push(`name = $${idx++}`);        values.push(body.name); }
    if (body.description != null) { fields.push(`description = $${idx++}`); values.push(body.description); }

    if (fields.length === 0) {
        return reply.code(400).send({
            success: false,
            error: { code: 'NO_FIELDS', message: 'No fields provided to update.' },
        });
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const result = await pool.query(
        `UPDATE organisations SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, name, description, updated_at`,
        values
    );

    return reply.code(200).send({ success: true, data: result.rows[0] });
}

// ─────────────────────────────────────────────
// DELETE /api/v1/organisations/:id (ADMIN only)
// ─────────────────────────────────────────────
export async function deleteOrganisation(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };

    const result = await pool.query('DELETE FROM organisations WHERE id = $1', [id]);

    if (result.rowCount === 0) {
        return reply.code(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Organisation not found.' },
        });
    }

    return reply.code(200).send({ success: true, data: { message: 'Organisation deleted.' } });
}
