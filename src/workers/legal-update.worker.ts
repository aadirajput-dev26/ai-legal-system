import cron from 'node-cron';
import { LegalUpdateService } from '../services/legal-update.service.js';

export function startLegalUpdateWorker(): void {
    console.log('[LegalUpdateWorker] Started – scheduling daily refresh at 00:00.');

    // Run once immediately on startup so we have some data initially
    LegalUpdateService.refreshUpdates().catch(err => {
        console.error('[LegalUpdateWorker] Initial refresh failed:', err.message);
    });

    // Schedule to run every day at midnight (server time)
    cron.schedule('0 0 * * *', () => {
        console.log('[LegalUpdateWorker] Running scheduled daily refresh...');
        LegalUpdateService.refreshUpdates().catch(err => {
            console.error('[LegalUpdateWorker] Scheduled refresh failed:', err.message);
        });
    });
}
