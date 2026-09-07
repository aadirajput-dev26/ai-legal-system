import { FastifyInstance } from 'fastify';
import { LegalUpdateController } from '../controllers/legal-update.controller.js';
import { authenticate } from '../middlewares/authenticate.js';

export async function legalUpdateRoutes(fastify: FastifyInstance) {
    fastify.get(
        '/legal-updates',
        { preHandler: [authenticate] },
        LegalUpdateController.getUpdates
    );
}
