import { FastifyRequest, FastifyReply } from 'fastify';
import { OrgMemberRepository } from '../repositories/org-member.repository.js';
import { UserRepository } from '../repositories/user.repository.js';
import type { Role } from '../types/index.js';

// ─────────────────────────────────────────────
// GET /api/v1/organisations/:id/members
// ─────────────────────────────────────────────
export async function listOrgMembers(req: FastifyRequest, reply: FastifyReply) {
    const { id: orgId } = req.params as { id: string };

    const members = await OrgMemberRepository.listMembers(orgId);

    return reply.code(200).send({ success: true, data: members });
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
    const user = await UserRepository.findByEmail(email);

    if (!user) {
        return reply.code(404).send({
            success: false,
            error: {
                code   : 'USER_NOT_FOUND',
                message: `User account with email '${email}' does not exist. The user must sign up first before being added to an organisation.`,
            },
        });
    }

    // Upsert: update role if already a member
    await OrgMemberRepository.addMember(orgId, user.id, role);

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

    const updated = await OrgMemberRepository.updateRole(orgId, targetUserId, role);

    if (!updated) {
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

    const removed = await OrgMemberRepository.removeMember(orgId, targetUserId);

    if (!removed) {
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
