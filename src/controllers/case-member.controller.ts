import { FastifyRequest, FastifyReply } from 'fastify';
import pool from '../lib/db.js';
import type { Role } from '../types/index.js';

// ─────────────────────────────────────────────
// GET /api/v1/cases/:id/members
// ─────────────────────────────────────────────
export async function listCaseMembers(req: FastifyRequest, reply: FastifyReply) {
    const { id: caseId } = req.params as { id: string };

    const result = await pool.query<{
        user_id: string; name: string; email: string; avatar: string | null;
        role: Role; joined_at: string;
    }>(
        `SELECT u.id AS user_id, u.name, u.email, u.avatar, cm.role, cm.joined_at
         FROM case_members cm
         JOIN users u ON u.id = cm.user_id
         WHERE cm.case_id = $1
         ORDER BY cm.joined_at ASC`,
        [caseId]
    );

    return reply.code(200).send({ success: true, data: result.rows });
}

// ─────────────────────────────────────────────
// POST /api/v1/cases/:id/members
// Add an org member to a case (Case ADMIN only)
// ─────────────────────────────────────────────
interface AddCaseMemberBody { userId: string; role: Role; }

export async function addCaseMember(req: FastifyRequest, reply: FastifyReply) {
    const { id: caseId } = req.params as { id: string };
    const { userId: targetUserId, role } = req.body as AddCaseMemberBody;

    // Get case to find parent org
    const caseResult = await pool.query<{ organisation_id: string }>(
        'SELECT organisation_id FROM cases WHERE id = $1',
        [caseId]
    );
    if (!caseResult.rows[0]) {
        return reply.code(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Case not found.' },
        });
    }

    const orgId = caseResult.rows[0].organisation_id;

    // Prerequisite: target user must already be an org member
    const orgCheck = await pool.query(
        'SELECT 1 FROM organisation_members WHERE organisation_id = $1 AND user_id = $2',
        [orgId, targetUserId]
    );
    if (orgCheck.rows.length === 0) {
        return reply.code(400).send({
            success: false,
            error: {
                code   : 'NOT_ORG_MEMBER',
                message: 'The user must be a member of the parent organisation before being added to a case.',
            },
        });
    }

    await pool.query(
        `INSERT INTO case_members (case_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (case_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [caseId, targetUserId, role]
    );

    return reply.code(200).send({
        success: true,
        data   : { message: `User added to case with role '${role}'.` },
    });
}

// ─────────────────────────────────────────────
// PATCH /api/v1/cases/:id/members/:userId
// ─────────────────────────────────────────────
interface UpdateCaseMemberRoleBody { role: Role; }

export async function updateCaseMemberRole(req: FastifyRequest, reply: FastifyReply) {
    const { id: caseId, userId: targetUserId } = req.params as { id: string; userId: string };
    const { role } = req.body as UpdateCaseMemberRoleBody;

    const result = await pool.query(
        `UPDATE case_members SET role = $1 WHERE case_id = $2 AND user_id = $3`,
        [role, caseId, targetUserId]
    );

    if (result.rowCount === 0) {
        return reply.code(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Member not found in this case.' },
        });
    }

    return reply.code(200).send({ success: true, data: { message: `Role updated to '${role}'.` } });
}

// ─────────────────────────────────────────────
// DELETE /api/v1/cases/:id/members/:userId
// ─────────────────────────────────────────────
export async function removeCaseMember(req: FastifyRequest, reply: FastifyReply) {
    const { id: caseId, userId: targetUserId } = req.params as { id: string; userId: string };

    const result = await pool.query(
        `DELETE FROM case_members WHERE case_id = $1 AND user_id = $2`,
        [caseId, targetUserId]
    );

    if (result.rowCount === 0) {
        return reply.code(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Member not found in this case.' },
        });
    }

    return reply.code(200).send({ success: true, data: { message: 'Member removed from case.' } });
}
