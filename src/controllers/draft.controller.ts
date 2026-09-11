import { FastifyRequest, FastifyReply } from 'fastify';
import { Readable } from 'stream';
import { DraftRepository } from '../repositories/draft.repository.js';
import { DraftService } from '../services/draft.service.js';
import { CaseRepository } from '../repositories/case.repository.js';
import type { DraftType, DraftStatus, UpdateDraftParams } from '../repositories/draft.repository.js';

// ── Helpers ───────────────────────────────────────────────────────

function extractAccessToken(req: FastifyRequest): string {
    const authHeader = req.headers.authorization || '';
    return authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
}

async function pipeStreamToReply(gtwyStream: Response, reply: FastifyReply, initialChunk?: string) {
    reply.header('Content-Type', 'text/event-stream');
    reply.header('Cache-Control', 'no-cache');
    reply.header('Connection', 'keep-alive');
    reply.header('X-Accel-Buffering', 'no');

    async function* streamGenerator() {
        if (initialChunk) {
            yield Buffer.from(initialChunk);
        }
        const reader = gtwyStream.body!.getReader();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                yield Buffer.from(value);
            }
        } finally {
            reader.releaseLock();
        }
    }

    return reply.send(Readable.from(streamGenerator()));
}

// ── Controllers ───────────────────────────────────────────────────

/** GET /organisations/:id/drafts */
export async function listOrgDrafts(req: FastifyRequest, reply: FastifyReply) {
    try {
        const { id: orgId } = req.params as { id: string };
        const user = req.user as { userId: string };

        const drafts = await DraftRepository.listByOrgAndUser(orgId, user.userId);
        return reply.code(200).send({ success: true, data: drafts });
    } catch (err: any) {
        return reply.code(500).send({ success: false, error: err.message });
    }
}

/** GET /api/v1/cases/:id/drafts */
export async function listDrafts(req: FastifyRequest, reply: FastifyReply) {
    try {
        const { id: caseId } = req.params as { id: string };

        const c = await CaseRepository.findById(caseId);
        if (!c) return reply.code(404).send({ success: false, error: 'Case not found' });

        const drafts = await DraftRepository.listByCase(caseId);
        return reply.code(200).send({ success: true, data: drafts });
    } catch (err: any) {
        return reply.code(500).send({ success: false, error: err.message });
    }
}

/** GET /api/v1/cases/:id/drafts/:draftId */
export async function getDraft(req: FastifyRequest, reply: FastifyReply) {
    try {
        const { id: caseId, draftId } = req.params as { id: string; draftId: string };

        const draft = await DraftRepository.findById(draftId);
        if (!draft || draft.case_id !== caseId) {
            return reply.code(404).send({ success: false, error: 'Draft not found' });
        }

        const versions = await DraftRepository.getVersions(draftId);
        return reply.code(200).send({ success: true, data: { ...draft, versions } });
    } catch (err: any) {
        return reply.code(500).send({ success: false, error: err.message });
    }
}

/**
 * POST /api/v1/cases/:id/drafts/generate
 * Creates a draft record then streams the AI-generated content.
 * Body: { title, description?, draftType, instructions? }
 */
export async function generateDraft(req: FastifyRequest, reply: FastifyReply) {
    try {
        const { id: caseId } = req.params as { id: string };
        const body = req.body as {
            title: string;
            description?: string;
            draftType?: DraftType;
            instructions?: string;
        };

        if (!body?.title) {
            return reply.code(400).send({ success: false, error: 'title is required' });
        }

        const user = req.user as { userId: string };

        // Create the draft record first (empty content — will be filled by stream on client)
        const draft = await DraftRepository.create({
            caseId,
            title: body.title,
            description: body.description,
            draftType: body.draftType ?? 'OTHER',
            instructions: body.instructions,
            createdBy: user.userId,
        });

        const accessToken = extractAccessToken(req);

        // Use draftId as GTWY thread ID for isolated context
        const gtwyStream = await DraftService.generateDraftStream(
            caseId,
            draft.draft_type,
            body.instructions || '',
            accessToken,
            draft.id
        );

        // Include draftId in headers and expose for CORS
        reply.header('X-Draft-Id', draft.id);
        reply.header('Access-Control-Expose-Headers', 'X-Draft-Id');

        const initialChunk = `data: {"event":"draft_created","draftId":"${draft.id}"}\n\n`;
        return pipeStreamToReply(gtwyStream, reply, initialChunk);
    } catch (err: any) {
        return reply.code(500).send({ success: false, error: err.message });
    }
}

/**
 * POST /api/v1/cases/:id/drafts/:draftId/refine
 * Streams an AI refinement over an existing draft's content.
 * Body: { prompt, selectedText?, currentContent }
 */
export async function refineDraft(req: FastifyRequest, reply: FastifyReply) {
    try {
        const { id: caseId, draftId } = req.params as { id: string; draftId?: string };
        const body = req.body as {
            prompt: string;
            selectedText?: string;
            currentContent: string;
        };

        if (!draftId || draftId.trim() === '' || draftId === 'undefined') {
            return reply.code(400).send({
                success: false,
                error: 'draftId parameter is required in URL path: /cases/:id/drafts/:draftId/refine'
            });
        }

        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(draftId)) {
            return reply.code(400).send({
                success: false,
                error: `Invalid draftId: "${draftId}" is not a valid UUID`
            });
        }

        if (!body?.prompt || !body?.currentContent) {
            return reply.code(400).send({ success: false, error: 'prompt and currentContent are required' });
        }

        const draft = await DraftRepository.findById(draftId);
        if (!draft || draft.case_id !== caseId) {
            return reply.code(404).send({ success: false, error: 'Draft not found' });
        }

        // Save snapshot of current content before AI refinement
        await DraftRepository.saveVersion(draftId, body.currentContent, 'AI_REFINEMENT', body.prompt);

        const accessToken = extractAccessToken(req);

        const gtwyStream = await DraftService.refineDraftStream(
            caseId,
            body.currentContent,
            body.prompt,
            body.selectedText,
            accessToken,
            `${draftId}-refine-${Date.now()}`
        );

        return pipeStreamToReply(gtwyStream, reply);
    } catch (err: any) {
        return reply.code(500).send({ success: false, error: err.message });
    }
}

/**
 * PATCH /api/v1/cases/:id/drafts/:draftId
 * Saves manual edits or updates draft status.
 * Body: { title?, description?, status?, instructions?, currentContent? }
 */
export async function updateDraft(req: FastifyRequest, reply: FastifyReply) {
    try {
        const { id: caseId, draftId } = req.params as { id: string; draftId: string };
        const body = req.body as UpdateDraftParams & { saveVersion?: boolean };

        const draft = await DraftRepository.findById(draftId);
        if (!draft || draft.case_id !== caseId) {
            return reply.code(404).send({ success: false, error: 'Draft not found' });
        }

        // If the lawyer is saving new content manually and requests a version checkpoint
        if (body.currentContent && body.saveVersion) {
            await DraftRepository.saveVersion(draftId, draft.current_content, 'MANUAL_SAVE');
        }

        const updated = await DraftRepository.update(draftId, body);
        if (!updated) {
            return reply.code(400).send({ success: false, error: 'No valid fields to update' });
        }

        return reply.code(200).send({ success: true, data: updated });
    } catch (err: any) {
        return reply.code(500).send({ success: false, error: err.message });
    }
}

/** DELETE /api/v1/cases/:id/drafts/:draftId */
export async function deleteDraft(req: FastifyRequest, reply: FastifyReply) {
    try {
        const { id: caseId, draftId } = req.params as { id: string; draftId: string };

        const draft = await DraftRepository.findById(draftId);
        if (!draft || draft.case_id !== caseId) {
            return reply.code(404).send({ success: false, error: 'Draft not found' });
        }

        await DraftRepository.delete(draftId);
        return reply.code(200).send({ success: true, data: { message: 'Draft deleted' } });
    } catch (err: any) {
        return reply.code(500).send({ success: false, error: err.message });
    }
}

/** GET /api/v1/cases/:id/drafts/:draftId/versions */
export async function getDraftVersions(req: FastifyRequest, reply: FastifyReply) {
    try {
        const { id: caseId, draftId } = req.params as { id: string; draftId: string };

        const draft = await DraftRepository.findById(draftId);
        if (!draft || draft.case_id !== caseId) {
            return reply.code(404).send({ success: false, error: 'Draft not found' });
        }

        const versions = await DraftRepository.getVersions(draftId);
        return reply.code(200).send({ success: true, data: versions });
    } catch (err: any) {
        return reply.code(500).send({ success: false, error: err.message });
    }
}
