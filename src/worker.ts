import 'dotenv/config';
import { startHearingWorker } from './workers/hearing.worker.js';
import { startLegalUpdateWorker } from './workers/legal-update.worker.js';

console.log('[Worker] Starting Hearing Notification Worker...');
startHearingWorker();

console.log('[Worker] Starting Legal Update Worker...');
startLegalUpdateWorker();

// Keep the process alive indefinitely (the cron keeps running)
