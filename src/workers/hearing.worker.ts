import cron from 'node-cron';
import { HearingRepository } from '../repositories/hearing.repository.js';
import { CaseRepository } from '../repositories/case.repository.js';
import { CaseMemberRepository } from '../repositories/case-member.repository.js';
import { WebhookService } from '../services/webhook.service.js';

type Stage = 'immediately' | '24h' | '1h';

async function processStage(stage: Stage) {
    let hearings;
    if (stage === 'immediately') {
        hearings = await HearingRepository.getHearingsForImmediateNotification();
    } else if (stage === '24h') {
        hearings = await HearingRepository.getHearingsDue24hNotification();
    } else {
        hearings = await HearingRepository.getHearingsDue1hNotification();
    }

    if (hearings.length === 0) return;

    console.log(`[HearingWorker] Processing ${hearings.length} hearing(s) for stage: "${stage}"`);

    for (const hearing of hearings) {
        try {
            // Fetch case details and all case members
            const [caseData, members] = await Promise.all([
                CaseRepository.findById(hearing.case_id),
                CaseMemberRepository.listMembers(hearing.case_id),
            ]);

            if (!caseData) {
                console.warn(`[HearingWorker] Case ${hearing.case_id} not found for hearing ${hearing.id} – skipping.`);
                continue;
            }

            // Send the notification via webhook
            await WebhookService.sendHearingReminder(hearing, caseData, members, stage);

            // Mark this stage as done
            await HearingRepository.markNotified(hearing.id, stage);

            // After marking, re-fetch to check if all stages are complete
            const updated = await HearingRepository.listByCaseId(hearing.case_id);
            const thisHearing = updated.find(h => h.id === hearing.id);
            if (
                thisHearing?.notified_immediately &&
                thisHearing?.notified_24h &&
                thisHearing?.notified_1h
            ) {
                await HearingRepository.markCompleted(hearing.id);
                console.log(`[HearingWorker] ✅ Hearing ${hearing.id} fully notified – marked COMPLETED.`);
            }
        } catch (err: any) {
            console.error(`[HearingWorker] Error processing hearing ${hearing.id} (stage: ${stage}): ${err.message}`);
        }
    }
}

async function runWorker() {
    console.log('[HearingWorker] Running notification check...');
    await Promise.all([
        processStage('immediately'),
        processStage('24h'),
        processStage('1h'),
    ]);
}

/**
 * Initialise the cron-based hearing worker.
 * Runs every 15 minutes.
 */
export function startHearingWorker(): void {
    console.log('[HearingWorker] Started – running every 15 minutes.');

    // Run immediately on startup
    runWorker().catch(err => console.error('[HearingWorker] Initial run failed:', err.message));

    // Then schedule every 15 minutes
    cron.schedule('*/15 * * * *', () => {
        runWorker().catch(err => console.error('[HearingWorker] Scheduled run failed:', err.message));
    });
}
