import { FastifyRequest, FastifyReply } from 'fastify';
import { HearingRepository } from '../repositories/hearing.repository.js';

export const createHearing = async (
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
) => {
    try {
        const caseId = req.params.id;
        const body = req.body as { date: string; notes?: string };

        if (!body?.date) {
            return reply.status(400).send({ error: 'date is required (ISO 8601 string)' });
        }

        const date = new Date(body.date);
        if (isNaN(date.getTime())) {
            return reply.status(400).send({ error: 'Invalid date format. Use ISO 8601 (e.g. 2026-09-15T10:00:00Z)' });
        }

        if (date <= new Date()) {
            return reply.status(400).send({ error: 'Hearing date must be in the future' });
        }

        const hearing = await HearingRepository.create(caseId, date, body.notes ?? '');
        return reply.status(201).send({ success: true, hearing });
    } catch (error: any) {
        return reply.status(500).send({ error: error.message });
    }
};

export const listHearings = async (
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
) => {
    try {
        const caseId = req.params.id;
        const hearings = await HearingRepository.listByCaseId(caseId);
        return reply.send({ success: true, hearings });
    } catch (error: any) {
        return reply.status(500).send({ error: error.message });
    }
};
