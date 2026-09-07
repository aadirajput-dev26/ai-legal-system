import { FastifyRequest, FastifyReply } from 'fastify';
import { LegalUpdateService } from '../services/legal-update.service.js';

export const LegalUpdateController = {
    /**
     * Get up to 5 random daily legal updates for display while loading.
     */
    async getUpdates(req: FastifyRequest, reply: FastifyReply) {
        try {
            const updates = LegalUpdateService.getRandomUpdates(5);
            
            // Clean up to make sure no internal backend keys are exposed
            const safeUpdates = updates.map(u => ({
                id: u.id,
                type: u.type,
                title: u.title,
                summary: u.summary,
                source: u.source,
                date: u.date
            }));
            
            return reply.send({ success: true, updates: safeUpdates });
        } catch (error: any) {
            console.error('[LegalUpdateController] Fetch updates failed:', error.message);
            // Even if it fails, return empty gracefully so UI doesn't crash
            return reply.status(500).send({ success: false, updates: [], error: 'Failed to fetch legal updates.' });
        }
    }
};
