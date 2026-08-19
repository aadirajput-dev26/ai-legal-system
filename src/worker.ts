import 'dotenv/config';
import { startHearingWorker } from './workers/hearing.worker.js';

console.log('[Worker] Starting Hearing Notification Worker...');
startHearingWorker();

// Keep the process alive indefinitely (the cron keeps running)
