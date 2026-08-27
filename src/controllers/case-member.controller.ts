import { FastifyRequest, FastifyReply } from 'fastify';
import { CaseMemberRepository } from '../repositories/case-member.repository.js';
import { CaseRepository } from '../repositories/case.repository.js';
import { OrgMemberRepository } from '../repositories/org-member.repository.js';
import { UserRepository } from '../repositories/user.repository.js';
import type { Role } from '../types/index.js';

// ─────────────────────────────────────────────
// GET /api/v1/cases/:id/members
// ─────────────────────────────────────────────
export async function listCaseMembers(req: FastifyRequest, reply: FastifyReply) {
    const { id: caseId } = req.params as { id: string };

    const members = await CaseMemberRepository.listMembers(caseId);

    return reply.code(200).send({ success: true, data: members });
}

// ─────────────────────────────────────────────
// POST /api/v1/cases/:id/members
// Add an org member to a case (Case ADMIN only)
// ─────────────────────────────────────────────
interface AddCaseMemberBody { email: string; role: Role; }

export async function addCaseMember(req: FastifyRequest, reply: FastifyReply) {
    const { id: caseId } = req.params as { id: string };
    const { email, role } = req.body as AddCaseMemberBody;

    // Get case to find parent org
    const c = await CaseRepository.findById(caseId);
    if (!c) {
        return reply.code(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Case not found.' },
        });
    }

    const orgId = c.organisation_id;

    // Look up user by email
    const user = await UserRepository.findByEmail(email);
    if (!user) {
        return reply.code(400).send({
            success: false,
            error: {
                code   : 'USER_NOT_FOUND',
                message: 'User not found. They must sign up first before you can invite them.',
            },
        });
    }

    const targetUserId = user.id;

    // If target user is not an org member, automatically add them as a VIEWER
    const orgRole = await OrgMemberRepository.getRole(orgId, targetUserId);
    if (!orgRole) {
        await OrgMemberRepository.addMember(orgId, targetUserId, 'VIEWER');
    }

    await CaseMemberRepository.addMember(caseId, targetUserId, role);

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

    const updated = await CaseMemberRepository.updateRole(caseId, targetUserId, role);

    if (!updated) {
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

    const removed = await CaseMemberRepository.removeMember(caseId, targetUserId);

    if (!removed) {
        return reply.code(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Member not found in this case.' },
        });
    }

    return reply.code(200).send({ success: true, data: { message: 'Member removed from case.' } });
}
