import { FastifyRequest, FastifyReply } from 'fastify';
import pool from '../lib/db.js';
import type { Role } from '../types/index.js';

// ─────────────────────────────────────────────
// GET /api/v1/organisations/:id/members
// ─────────────────────────────────────────────
export async function listOrgMembers(req: FastifyRequest, reply: FastifyReply) {
    const { id: orgId } = req.params as { id: string };

    const result = await pool.query<{
        user_id: string; name: string; email: string; avatar: string | null;
        role: Role; joined_at: string;
    }>(
        `SELECT u.id AS user_id, u.name, u.email, u.avatar, om.role, om.joined_at
         FROM organisation_members om
         JOIN users u ON u.id = om.user_id
         WHERE om.organisation_id = $1
         ORDER BY om.joined_at ASC`,
        [orgId]
    );

    return reply.code(200).send({ success: true, data: result.rows });
}

// ─────────────────────────────────────────────
// POST /api/v1/organisations/:id/members
// Invite an existing user to org by email (ADMIN only)
// ─────────────────────────────────────────────
interface AddMemberBody { email: string; role: Role; }

export async function addOrgMember(req: FastifyRequest, reply: FastifyReply) {
    const { id: orgId } = req.params as { id: string };
    const { email, role } = req.body as AddMemberBody;

    // Strict check: user account must exist
    const userResult = await pool.query<{ id: string }>(
        'SELECT id FROM users WHERE email = $1',
        [email.toLowerCase()]
    );

    if (!userResult.rows[0]) {
        return reply.code(404).send({
            success: false,
            error: {
                code   : 'USER_NOT_FOUND',
                message: `User account with email '${email}' does not exist. The user must sign up first before being added to an organisation.`,
            },
        });
    }

    const userId = userResult.rows[0].id;

    // Upsert: update role if already a member
    await pool.query(
        `INSERT INTO organisation_members (organisation_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (organisation_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [orgId, userId, role]
    );

    return reply.code(200).send({
        success: true,
        data   : { message: `User '${email}' added to organisation with role '${role}'.` },
    });
}

// ─────────────────────────────────────────────
// PATCH /api/v1/organisations/:id/members/:userId
// Update a member's org role (ADMIN only)
// ─────────────────────────────────────────────
interface UpdateMemberRoleBody { role: Role; }

export async function updateOrgMemberRole(req: FastifyRequest, reply: FastifyReply) {
    const { id: orgId, userId: targetUserId } = req.params as { id: string; userId: string };
    const { role } = req.body as UpdateMemberRoleBody;

    const result = await pool.query(
        `UPDATE organisation_members SET role = $1
         WHERE organisation_id = $2 AND user_id = $3`,
        [role, orgId, targetUserId]
    );

    if (result.rowCount === 0) {
        return reply.code(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Member not found in this organisation.' },
        });
    }

    return reply.code(200).send({
        success: true,
        data   : { message: `Member role updated to '${role}'.` },
    });
}

// ─────────────────────────────────────────────
// DELETE /api/v1/organisations/:id/members/:userId
// Remove a member from the org (ADMIN only)
// ─────────────────────────────────────────────
export async function removeOrgMember(req: FastifyRequest, reply: FastifyReply) {
    const { id: orgId, userId: targetUserId } = req.params as { id: string; userId: string };

    const result = await pool.query(
        `DELETE FROM organisation_members
         WHERE organisation_id = $1 AND user_id = $2`,
        [orgId, targetUserId]
    );

    if (result.rowCount === 0) {
        return reply.code(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Member not found in this organisation.' },
        });
    }

    return reply.code(200).send({
        success: true,
        data   : { message: 'Member removed from organisation.' },
    });
}
