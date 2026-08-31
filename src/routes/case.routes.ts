import { FastifyInstance } from 'fastify';
import { authenticate } from '../middlewares/authenticate.js';
import { requireOrgRole, requireCaseRole } from '../middlewares/rbac.js';
import * as caseController from '../controllers/case.controller.js';
import * as caseMemberController from '../controllers/case-member.controller.js';
import * as documentController from '../controllers/document.controller.js';
import * as chatController from '../controllers/chat.controller.js';
import * as hearingController from '../controllers/hearing.controller.js';
import * as toolController from '../controllers/tool.controller.js';
import * as taskController from '../controllers/task.controller.js';

export async function caseRoutes(app: FastifyInstance) {
    // ── Cases within an Org ────────────────────────────────────────
    app.get('/organisations/:id/cases', {
        preHandler: [authenticate, requireOrgRole(['ADMIN', 'EDITOR', 'VIEWER'])]
    }, caseController.listCases);

    app.get('/organisations/:id/calendar', {
        preHandler: [authenticate, requireOrgRole(['ADMIN', 'EDITOR', 'VIEWER'])]
    }, caseController.getOrgCalendar);

    app.get('/organisations/:id/documents', {
        preHandler: [authenticate, requireOrgRole(['ADMIN', 'EDITOR', 'VIEWER'])]
    }, documentController.listOrgDocuments);

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

    // ── Case Documents ─────────────────────────────────────────────
    app.get<{ Params: { id: string } }>('/cases/:id/documents', { preHandler: [authenticate, requireCaseRole(['ADMIN', 'EDITOR', 'VIEWER'])] }, documentController.listDocuments);
    app.get<{ Params: { id: string; resourceId: string } }>('/cases/:id/documents/:resourceId', { preHandler: [authenticate, requireCaseRole(['ADMIN', 'EDITOR', 'VIEWER'])] }, documentController.getDocument);
    app.post<{ Params: { id: string } }>('/cases/:id/documents', { preHandler: [authenticate, requireCaseRole(['ADMIN', 'EDITOR'])] }, documentController.createDocument);
    app.patch<{ Params: { id: string; resourceId: string } }>('/cases/:id/documents/:resourceId', { preHandler: [authenticate, requireCaseRole(['ADMIN', 'EDITOR'])] }, documentController.updateDocument);
    app.delete<{ Params: { id: string; resourceId: string } }>('/cases/:id/documents/:resourceId', { preHandler: [authenticate, requireCaseRole(['ADMIN', 'EDITOR'])] }, documentController.deleteDocument);

    // ── Chat & Orchestrator ────────────────────────────────────────
    app.get<{ Params: { id: string } }>('/cases/:id/chats', { preHandler: [authenticate, requireCaseRole(['ADMIN', 'EDITOR', 'VIEWER'])] }, chatController.listChats);
    app.post<{ Params: { id: string } }>('/cases/:id/chats', { preHandler: [authenticate, requireCaseRole(['ADMIN', 'EDITOR'])] }, chatController.createChat);
    app.get<{ Params: { id: string, chatId: string } }>('/cases/:id/chats/:chatId/history', { preHandler: [authenticate, requireCaseRole(['ADMIN', 'EDITOR', 'VIEWER'])] }, chatController.getChatHistory);
    app.post<{ Params: { id: string, chatId: string } }>('/cases/:id/chats/:chatId/message', { preHandler: [authenticate, requireCaseRole(['ADMIN', 'EDITOR'])] }, chatController.sendMessage);

    // ── Hearings ───────────────────────────────────────────────────
    app.get<{ Params: { id: string } }>('/cases/:id/hearings',  { preHandler: [authenticate, requireCaseRole(['ADMIN', 'EDITOR', 'VIEWER'])] }, hearingController.listHearings);
    app.post<{ Params: { id: string } }>('/cases/:id/hearings', { preHandler: [authenticate, requireCaseRole(['ADMIN', 'EDITOR'])] }, hearingController.createHearing);

    // ── Tasks ──────────────────────────────────────────────────────
    app.get<{ Params: { id: string } }>('/cases/:id/tasks', { preHandler: [authenticate, requireCaseRole(['ADMIN', 'EDITOR', 'VIEWER'])] }, taskController.listTasks);
    app.post<{ Params: { id: string } }>('/cases/:id/tasks', { preHandler: [authenticate, requireCaseRole(['ADMIN', 'EDITOR'])] }, taskController.createTask);
    app.patch<{ Params: { id: string, taskId: string } }>('/cases/:id/tasks/:taskId', { preHandler: [authenticate, requireCaseRole(['ADMIN', 'EDITOR'])] }, taskController.updateTask);
    app.delete<{ Params: { id: string, taskId: string } }>('/cases/:id/tasks/:taskId', { preHandler: [authenticate, requireCaseRole(['ADMIN', 'EDITOR'])] }, taskController.deleteTask);

    // ── Tools ──────────────────────────────────────────────────────
    app.get<{ Params: { id: string } }>('/cases/:id/tools', { preHandler: [authenticate, requireCaseRole(['ADMIN', 'EDITOR', 'VIEWER'])] }, toolController.listTools);
    app.post<{ Params: { id: string } }>('/cases/:id/tools', { preHandler: [authenticate, requireCaseRole(['ADMIN', 'EDITOR'])] }, toolController.createOrUpdateTool);
    app.delete<{ Params: { id: string, scriptId: string } }>('/cases/:id/tools/:scriptId', { preHandler: [authenticate, requireCaseRole(['ADMIN', 'EDITOR'])] }, toolController.deleteTool);
    app.post<{ Params: { id: string } }>('/cases/:id/tools/import', { preHandler: [authenticate, requireCaseRole(['ADMIN', 'EDITOR'])] }, toolController.importTool);
    app.get<{ Params: { id: string; orgId: string } }>('/organisations/:orgId/cases/:id/tools/importable', { preHandler: [authenticate, requireCaseRole(['ADMIN', 'EDITOR'])] }, toolController.listImportableTools);
    app.get<{ Params: { id: string } }>('/cases/:id/tools/token', { preHandler: [authenticate, requireCaseRole(['ADMIN', 'EDITOR', 'VIEWER'])] }, toolController.getViasocketToken);
}
