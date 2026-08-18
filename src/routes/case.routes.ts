import { FastifyInstance } from 'fastify';
import { authenticate } from '../middlewares/authenticate.js';
import { requireOrgRole, requireCaseRole } from '../middlewares/rbac.js';
import * as caseController from '../controllers/case.controller.js';
import * as caseMemberController from '../controllers/case-member.controller.js';

export async function caseRoutes(app: FastifyInstance) {
    // ── Cases within an Org ────────────────────────────────────────
    app.get('/organisations/:id/cases', {
        preHandler: [authenticate, requireOrgRole(['ADMIN', 'EDITOR', 'VIEWER'])]
    }, caseController.listCases);

    app.post('/organisations/:id/cases', {
        preHandler: [authenticate, requireOrgRole(['ADMIN', 'EDITOR'])]
    }, caseController.createCase);

    // ── Case CRUD ──────────────────────────────────────────────────
    app.get('/cases/:id',    { preHandler: [authenticate, requireCaseRole(['ADMIN', 'EDITOR', 'VIEWER'])] }, caseController.getCase);
    app.patch('/cases/:id',  { preHandler: [authenticate, requireCaseRole(['ADMIN', 'EDITOR'])] }, caseController.updateCase);
    app.delete('/cases/:id', { preHandler: [authenticate, requireCaseRole(['ADMIN'])] }, caseController.deleteCase);

    // ── Case Member Management ─────────────────────────────────────
    app.get('/cases/:id/members',            { preHandler: [authenticate, requireCaseRole(['ADMIN', 'EDITOR', 'VIEWER'])] }, caseMemberController.listCaseMembers);
    app.post('/cases/:id/members',           { preHandler: [authenticate, requireCaseRole(['ADMIN'])] }, caseMemberController.addCaseMember);
    app.patch('/cases/:id/members/:userId',  { preHandler: [authenticate, requireCaseRole(['ADMIN'])] }, caseMemberController.updateCaseMemberRole);
    app.delete('/cases/:id/members/:userId', { preHandler: [authenticate, requireCaseRole(['ADMIN'])] }, caseMemberController.removeCaseMember);
}
