import { CaseRepository } from '../repositories/case.repository.js';
import { HearingRepository } from '../repositories/hearing.repository.js';
import { TaskRepository } from '../repositories/task.repository.js';
import { GtwyService } from './gtwy.service.js';
import type { DraftType } from '../repositories/draft.repository.js';

export interface DraftContext {
    caseId: string;
    caseName: string;
    caseNumber: string | null;
    court: string | null;
    caseType: string | null;
    stage: string | null;
    judge: string | null;
    status: string;
    description: string | null;
    instructions: string | null;
    clientName: string | null;
    opposingParty: string | null;
    filingDate: string | null;
    hearingsSummary: string;
    tasksSummary: string;
    documentsSummary: string;
    collectionId: string | null;
}

export class DraftContextService {
    /**
     * Assembles a rich structured context payload from the case database records
     * and GTWY Hippocampus document vectors. This context is injected as variables
     * into the GTWY agent prompt for case-accurate draft generation.
     */
    static async buildContext(caseId: string): Promise<DraftContext> {
        // Fetch case details
        const caseRecord = await CaseRepository.findById(caseId);
        if (!caseRecord) {
            throw new Error(`Case ${caseId} not found`);
        }

        // Fetch hearings
        let hearingsSummary = 'No hearings recorded.';
        try {
            const hearings = await HearingRepository.listByCaseId(caseId);
            if (hearings.length > 0) {
                hearingsSummary = hearings
                    .map((h, i) => {
                        const date = new Date(h.date).toLocaleDateString('en-IN', {
                            day: '2-digit', month: 'short', year: 'numeric'
                        });
                        return `${i + 1}. Date: ${date} | Status: ${h.status}${h.notes ? ` | Notes: ${h.notes}` : ''}`;
                    })
                    .join('\n');
            }
        } catch (err) {
            console.error('[DraftContext] Failed to fetch hearings:', err);
        }

        // Fetch tasks/notes
        let tasksSummary = 'No tasks or notes recorded.';
        try {
            const tasksList = await TaskRepository.listByCase(caseId);
            if (tasksList.length > 0) {
                tasksSummary = tasksList
                    .map((t, i) => {
                        return `${i + 1}. [${t.status}] ${t.title}${t.description ? `: ${t.description}` : ''}${t.due_date ? ` (Due: ${t.due_date})` : ''}`;
                    })
                    .join('\n');
            }
        } catch (err) {
            console.error('[DraftContext] Failed to fetch tasks:', err);
        }

        // Fetch case documents from GTWY Hippocampus
        let documentsSummary = 'No documents uploaded.';
        if (caseRecord.collection_id) {
            try {
                const resData = await GtwyService.getResourcesByCase(caseRecord.collection_id);
                const resources = resData?.resources || [];
                if (resources.length > 0) {
                    documentsSummary = resources
                        .map((r: any, i: number) => {
                            return `${i + 1}. "${r.title || r.name || 'Untitled'}"${r.description ? ` — ${r.description}` : ''}`;
                        })
                        .join('\n');
                }
            } catch (err) {
                console.error('[DraftContext] Failed to fetch documents:', err);
            }
        }

        return {
            caseId,
            caseName: caseRecord.title,
            caseNumber: caseRecord.case_number,
            court: caseRecord.court,
            caseType: caseRecord.case_type,
            stage: caseRecord.stage,
            judge: caseRecord.judge,
            status: caseRecord.status,
            description: caseRecord.description,
            instructions: caseRecord.instructions,
            clientName: caseRecord.client_name,
            opposingParty: caseRecord.opposing_party,
            filingDate: caseRecord.filing_date,
            hearingsSummary,
            tasksSummary,
            documentsSummary,
            collectionId: caseRecord.collection_id,
        };
    }

    /**
     * Converts a DraftContext into GTWY variables record (string values only).
     * Also injects draft-specific parameters (type, instructions).
     */
    static toVariables(
        ctx: DraftContext,
        draftType: DraftType,
        draftInstructions: string,
        accessToken: string
    ): Record<string, string> {
        return {
            caseId: ctx.caseId,
            collectionId: ctx.collectionId || '',
            accessToken,
            caseName: ctx.caseName,
            caseNumber: ctx.caseNumber || 'N/A',
            court: ctx.court || 'N/A',
            caseType: ctx.caseType || 'N/A',
            stage: ctx.stage || 'N/A',
            judge: ctx.judge || 'N/A',
            caseStatus: ctx.status,
            caseDescription: ctx.description || '',
            caseInstructions: ctx.instructions || '',
            clientName: ctx.clientName || 'Client',
            opposingParty: ctx.opposingParty || 'Opposite Party',
            filingDate: ctx.filingDate || 'N/A',
            hearingHistory: ctx.hearingsSummary,
            tasksSummary: ctx.tasksSummary,
            caseDocuments: ctx.documentsSummary,
            draftType,
            draftInstructions,
        };
    }
}
