import { FastifyRequest, FastifyReply } from 'fastify';
import { OrganisationRepository } from '../repositories/organisation.repository.js';

// ─────────────────────────────────────────────
// GET /api/v1/organisations
// Lists all organisations the current user belongs to
// ─────────────────────────────────────────────
export async function listOrganisations(req: FastifyRequest, reply: FastifyReply) {
    const { userId } = req.user;

    const orgs = await OrganisationRepository.listByUser(userId);

    return reply.code(200).send({ success: true, data: orgs });
}

// ─────────────────────────────────────────────
// POST /api/v1/organisations
// Creates a new organisation and assigns creator as ADMIN
// ─────────────────────────────────────────────
interface CreateOrgBody { name: string; description?: string; }

export async function createOrganisation(req: FastifyRequest, reply: FastifyReply) {
    const { name, description } = req.body as CreateOrgBody;
    const { userId } = req.user;

    try {
        const org = await OrganisationRepository.create(name, description ?? null, userId);
        return reply.code(201).send({ success: true, data: org });
    } catch (err) {
        throw err;
    }
}

// ─────────────────────────────────────────────
// GET /api/v1/organisations/:id
// ─────────────────────────────────────────────
export async function getOrganisation(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };

    const org = await OrganisationRepository.findById(id);

    if (!org) {
        return reply.code(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Organisation not found.' },
        });
    }

    return reply.code(200).send({ success: true, data: org });
}

// ─────────────────────────────────────────────
// PATCH /api/v1/organisations/:id
// Update organisation name/description (ADMIN only)
// ─────────────────────────────────────────────
interface UpdateOrgBody { name?: string; description?: string; }

export async function updateOrganisation(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };
    const body = req.body as UpdateOrgBody;

    const org = await OrganisationRepository.update(id, { name: body.name, description: body.description });

    if (!org) {
        return reply.code(400).send({
            success: false,
            error: { code: 'NO_FIELDS', message: 'No fields provided to update.' },
        });
    }

    return reply.code(200).send({ success: true, data: org });
}

// ─────────────────────────────────────────────
// DELETE /api/v1/organisations/:id (ADMIN only)
// ─────────────────────────────────────────────
export async function deleteOrganisation(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };

    const deleted = await OrganisationRepository.delete(id);

    if (!deleted) {
        return reply.code(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Organisation not found.' },
        });
    }

    return reply.code(200).send({ success: true, data: { message: 'Organisation deleted.' } });
}
