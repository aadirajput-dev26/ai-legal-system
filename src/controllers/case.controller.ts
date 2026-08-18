import { FastifyRequest, FastifyReply } from 'fastify';
import pool from '../lib/db.js';
import { createCollection, deleteCollection } from '../lib/hippocampus.js';

// ─────────────────────────────────────────────
// GET /api/v1/organisations/:id/cases
// Lists cases the current user can access within an org
// ─────────────────────────────────────────────
export async function listCases(req: FastifyRequest, reply: FastifyReply) {
    const { id: orgId } = req.params as { id: string };
    const { userId } = req.user;

    const result = await pool.query<{
        id: string; title: string; status: string; case_number: string | null;
        court: string | null; next_hearing_date: string | null;
        created_at: string; role: string;
    }>(
        `SELECT c.id, c.title, c.status, c.case_number, c.court,
                c.next_hearing_date, c.created_at, cm.role
         FROM cases c
         JOIN case_members cm ON cm.case_id = c.id
         WHERE c.organisation_id = $1 AND cm.user_id = $2
         ORDER BY c.created_at DESC`,
        [orgId, userId]
    );

    return reply.code(200).send({ success: true, data: result.rows });
}

// ─────────────────────────────────────────────
// POST /api/v1/organisations/:id/cases
// Creates a new case + provisions a Hippocampus collection
// Creator becomes Case ADMIN
// ─────────────────────────────────────────────
interface CreateCaseBody {
    title      : string;
    description?: string;
    case_number?: string;
    court      ?: string;
    case_type  ?: string;
    filing_date?: string;
}

export async function createCase(req: FastifyRequest, reply: FastifyReply) {
    const { id: orgId } = req.params as { id: string };
    const { userId } = req.user;
    const { title, description, case_number, court, case_type, filing_date } = req.body as CreateCaseBody;

    // Step 1: Provision Hippocampus collection for this case
    const collection = await createCollection(title);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const caseResult = await client.query<{
            id: string; title: string; status: string; collection_id: string;
        }>(
            `INSERT INTO cases
                (organisation_id, collection_id, title, description, case_number, court, case_type, filing_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, title, status, collection_id`,
            [orgId, collection.collection_id, title, description ?? null,
             case_number ?? null, court ?? null, case_type ?? null, filing_date ?? null]
        );

        const newCase = caseResult.rows[0];

        // Creator automatically becomes Case ADMIN
        await client.query(
            `INSERT INTO case_members (case_id, user_id, role) VALUES ($1, $2, 'ADMIN')`,
            [newCase.id, userId]
        );

        await client.query('COMMIT');
        return reply.code(201).send({ success: true, data: newCase });
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// ─────────────────────────────────────────────
// GET /api/v1/cases/:id
// ─────────────────────────────────────────────
export async function getCase(req: FastifyRequest, reply: FastifyReply) {
    const { id: caseId } = req.params as { id: string };

    const result = await pool.query<{
        id: string; title: string; description: string | null; status: string;
        case_number: string | null; court: string | null; case_type: string | null;
        collection_id: string | null; filing_date: string | null;
        next_hearing_date: string | null; created_at: string; updated_at: string;
    }>(
        `SELECT id, title, description, status, case_number, court, case_type,
                collection_id, filing_date, next_hearing_date, created_at, updated_at
         FROM cases WHERE id = $1`,
        [caseId]
    );

    if (!result.rows[0]) {
        return reply.code(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Case not found.' },
        });
    }

    return reply.code(200).send({ success: true, data: result.rows[0] });
}

// ─────────────────────────────────────────────
// PATCH /api/v1/cases/:id
// ─────────────────────────────────────────────
interface UpdateCaseBody {
    title            ?: string;
    description      ?: string;
    status           ?: string;
    court            ?: string;
    case_number      ?: string;
    case_type        ?: string;
    next_hearing_date?: string;
}

export async function updateCase(req: FastifyRequest, reply: FastifyReply) {
    const { id: caseId } = req.params as { id: string };
    const body = req.body as UpdateCaseBody;

    const fields: string[]  = [];
    const values: unknown[] = [];
    let idx = 1;

    if (body.title             != null) { fields.push(`title = $${idx++}`);             values.push(body.title); }
    if (body.description       != null) { fields.push(`description = $${idx++}`);       values.push(body.description); }
    if (body.status            != null) { fields.push(`status = $${idx++}`);            values.push(body.status); }
    if (body.court             != null) { fields.push(`court = $${idx++}`);             values.push(body.court); }
    if (body.case_number       != null) { fields.push(`case_number = $${idx++}`);       values.push(body.case_number); }
    if (body.case_type         != null) { fields.push(`case_type = $${idx++}`);         values.push(body.case_type); }
    if (body.next_hearing_date != null) { fields.push(`next_hearing_date = $${idx++}`); values.push(body.next_hearing_date); }

    if (fields.length === 0) {
        return reply.code(400).send({
            success: false,
            error: { code: 'NO_FIELDS', message: 'No fields provided to update.' },
        });
    }

    fields.push(`updated_at = NOW()`);
    values.push(caseId);

    const result = await pool.query(
        `UPDATE cases SET ${fields.join(', ')} WHERE id = $${idx}
         RETURNING id, title, status, case_number, court, next_hearing_date, updated_at`,
        values
    );

    return reply.code(200).send({ success: true, data: result.rows[0] });
}

// ─────────────────────────────────────────────
// DELETE /api/v1/cases/:id (ADMIN only)
// Also cleans up the Hippocampus collection
// ─────────────────────────────────────────────
export async function deleteCase(req: FastifyRequest, reply: FastifyReply) {
    const { id: caseId } = req.params as { id: string };

    // Fetch collection_id before deleting
    const caseRow = await pool.query<{ collection_id: string | null }>(
        'SELECT collection_id FROM cases WHERE id = $1',
        [caseId]
    );

    if (!caseRow.rows[0]) {
        return reply.code(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Case not found.' },
        });
    }

    // Delete from DB (cascade deletes case_members, etc.)
    await pool.query('DELETE FROM cases WHERE id = $1', [caseId]);

    // Best-effort: clean up Hippocampus collection (non-blocking)
    if (caseRow.rows[0].collection_id) {
        deleteCollection(caseRow.rows[0].collection_id).catch((err) =>
            console.error('Failed to delete Hippocampus collection:', err)
        );
    }

    return reply.code(200).send({ success: true, data: { message: 'Case deleted.' } });
}
