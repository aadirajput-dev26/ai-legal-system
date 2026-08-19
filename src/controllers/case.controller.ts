import { FastifyRequest, FastifyReply } from 'fastify';
import { CaseRepository } from '../repositories/case.repository.js';
import { createCollection, deleteCollection } from '../lib/hippocampus.js';

// ─────────────────────────────────────────────
// GET /api/v1/organisations/:id/cases
// Lists cases the current user can access within an org
// ─────────────────────────────────────────────
export async function listCases(req: FastifyRequest, reply: FastifyReply) {
    const { id: orgId } = req.params as { id: string };
    const { userId } = req.user;

    const cases = await CaseRepository.listByUserAndOrg(orgId, userId);

    return reply.code(200).send({ success: true, data: cases });
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
    instructions?: string;
    filing_date?: string;
}

export async function createCase(req: FastifyRequest, reply: FastifyReply) {
    const { id: orgId } = req.params as { id: string };
    const { userId } = req.user;
    const { title, description, case_number, court, case_type, instructions, filing_date } = req.body as CreateCaseBody;

    // Step 1: Provision Hippocampus collection for this case
    const collection = await createCollection(title);

    try {
        const newCase = await CaseRepository.create({
            organisationId: orgId,
            collectionId: collection.collection_id,
            title,
            description,
            caseNumber: case_number,
            court,
            caseType: case_type,
            instructions,
            filingDate: filing_date,
            userId,
        });

        return reply.code(201).send({ success: true, data: newCase });
    } catch (err) {
        throw err;
    }
}

// ─────────────────────────────────────────────
// GET /api/v1/cases/:id
// ─────────────────────────────────────────────
export async function getCase(req: FastifyRequest, reply: FastifyReply) {
    const { id: caseId } = req.params as { id: string };

    const c = await CaseRepository.findById(caseId);

    if (!c) {
        return reply.code(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Case not found.' },
        });
    }

    return reply.code(200).send({ success: true, data: c });
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
    instructions     ?: string;
    next_hearing_date?: string;
}

export async function updateCase(req: FastifyRequest, reply: FastifyReply) {
    const { id: caseId } = req.params as { id: string };
    const body = req.body as UpdateCaseBody;

    const c = await CaseRepository.update(caseId, {
        title: body.title,
        description: body.description,
        status: body.status,
        court: body.court,
        case_number: body.case_number,
        case_type: body.case_type,
        instructions: body.instructions,
        next_hearing_date: body.next_hearing_date,
    });

    if (!c) {
        return reply.code(400).send({
            success: false,
            error: { code: 'NO_FIELDS', message: 'No fields provided to update.' },
        });
    }

    return reply.code(200).send({ success: true, data: c });
}

// ─────────────────────────────────────────────
// DELETE /api/v1/cases/:id (ADMIN only)
// Also cleans up the Hippocampus collection
// ─────────────────────────────────────────────
export async function deleteCase(req: FastifyRequest, reply: FastifyReply) {
    const { id: caseId } = req.params as { id: string };

    // Fetch collection_id before deleting
    const c = await CaseRepository.findById(caseId);

    if (!c) {
        return reply.code(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Case not found.' },
        });
    }

    // Delete from DB (cascade deletes case_members, etc.)
    await CaseRepository.delete(caseId);

    // Best-effort: clean up Hippocampus collection (non-blocking)
    if (c.collection_id) {
        deleteCollection(c.collection_id).catch((err) =>
            console.error('Failed to delete Hippocampus collection:', err)
        );
    }

    return reply.code(200).send({ success: true, data: { message: 'Case deleted.' } });
}
