import { OrgMemberRepository } from '../repositories/org-member.repository.js';
import { CaseMemberRepository } from '../repositories/case-member.repository.js';
import { CaseRepository } from '../repositories/case.repository.js';
import type { Role } from '../types/index.js';

/**
 * requireOrgRole – factory that returns a preHandler hook.
 * Reads :id (orgId) from route params, queries organisation_members,
 * and ensures the authenticated user has one of the allowed roles.
 *
 * Usage:
 *   preHandler: [authenticate, requireOrgRole(['ADMIN'])]
 */
export function requireOrgRole(allowedRoles: Role[]) {
    return async function (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply): Promise<void> {
        const { id: orgId } = req.params as { id: string };
        const userId = (req.user as { userId: string }).userId;

        const role = await OrgMemberRepository.getRole(orgId, userId);

        if (!role || !allowedRoles.includes(role)) {
            reply.code(403).send({
                success: false,
                error: {
                    code   : 'INSUFFICIENT_PERMISSIONS',
                    message: `Role '${role ?? 'NONE'}' is not authorized to perform this action on the organisation.`,
                },
            });
        }
    };
}

/**
 * requireCaseRole – factory that returns a preHandler hook.
 * Reads :id (caseId) from route params, queries case_members,
 * and ensures the authenticated user has one of the allowed roles.
 *
 * Usage:
 *   preHandler: [authenticate, requireCaseRole(['ADMIN', 'EDITOR'])]
 */
export function requireCaseRole(allowedRoles: Role[]) {
    return async function (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply): Promise<void> {
        const { id: caseId } = req.params as { id: string };
        const userId = (req.user as { userId: string }).userId;

        let role = await CaseMemberRepository.getRole(caseId, userId);

        // If not explicitly in case_members, check if they are an ORG_ADMIN
        if (!role) {
            const caseObj = await CaseRepository.findById(caseId);
            if (caseObj) {
                const orgRole = await OrgMemberRepository.getRole(caseObj.organisation_id, userId);
                if (orgRole === 'ADMIN') {
                    role = 'ADMIN';
                }
            }
        }

        if (!role || !allowedRoles.includes(role)) {
            reply.code(403).send({
                success: false,
                error: {
                    code   : 'INSUFFICIENT_PERMISSIONS',
                    message: `Role '${role ?? 'NONE'}' is not authorized to perform this action on the case.`,
                },
            });
        }
    };
}
