import { FastifyInstance } from 'fastify';
import { authenticate } from '../middlewares/authenticate.js';
import { requireOrgRole } from '../middlewares/rbac.js';
import * as orgController from '../controllers/organisation.controller.js';
import * as orgMemberController from '../controllers/org-member.controller.js';

export async function organisationRoutes(app: FastifyInstance) {
    // ── Organisation CRUD ──────────────────────────────────────────
    app.get('/',    { preHandler: [authenticate] }, orgController.listOrganisations);
    app.post('/',   { preHandler: [authenticate] }, orgController.createOrganisation);

    app.get('/:id',    { preHandler: [authenticate, requireOrgRole(['ADMIN', 'EDITOR', 'VIEWER'])] }, orgController.getOrganisation);
    app.patch('/:id',  { preHandler: [authenticate, requireOrgRole(['ADMIN'])] }, orgController.updateOrganisation);
    app.delete('/:id', { preHandler: [authenticate, requireOrgRole(['ADMIN'])] }, orgController.deleteOrganisation);

    // ── Member Management ──────────────────────────────────────────
    app.get('/:id/members',              { preHandler: [authenticate, requireOrgRole(['ADMIN', 'EDITOR', 'VIEWER'])] }, orgMemberController.listOrgMembers);
    app.post('/:id/members',             { preHandler: [authenticate, requireOrgRole(['ADMIN'])] }, orgMemberController.addOrgMember);
    app.patch('/:id/members/:userId',    { preHandler: [authenticate, requireOrgRole(['ADMIN'])] }, orgMemberController.updateOrgMemberRole);
    app.delete('/:id/members/:userId',   { preHandler: [authenticate, requireOrgRole(['ADMIN'])] }, orgMemberController.removeOrgMember);
}
