import pool from '../lib/db.js';
import { CaseRepository } from '../repositories/case.repository.js';
import { HearingRepository } from '../repositories/hearing.repository.js';
import { TaskRepository } from '../repositories/task.repository.js';
import { ToolRepository } from '../repositories/tool.repository.js';
import { CaseMemberRepository } from '../repositories/case-member.repository.js';
import { GtwyService } from './gtwy.service.js';

export interface CaseContextResult {
    // Template Variables (exact match to GTWY variables)
    caseName: string;
    caseDescription: string;
    caseInstructions: string;
    availableTools: string;
    availableResources: string;

    // Direct case attributes
    caseId: string;
    collectionId: string;
    caseNumber: string;
    court: string;
    caseType: string;
    stage: string;
    judge: string;
    status: string;
    clientName: string;
    opposingParty: string;
    filingDate: string;
    nextHearingDate: string;

    // Structured related entities
    case: any;
    hearings: any[];
    tasks: any[];
    tools: any[];
    documents: any[];
    members: any[];

    // Summaries
    summaries: {
        hearingsSummary: string;
        tasksSummary: string;
        documentsSummary: string;
        toolsSummary: string;
    };

    // Full variables map for agent / prompt injection
    variables: Record<string, string>;
}

export class CaseContextService {
    /**
     * Builds full context for a case, assembling the exact variables for availableTools,
     * availableResources, caseName, caseDescription, caseInstructions, and all related
     * entities (hearings, tasks, judge, court, members, etc.).
     */
    static async getFullCaseContext(caseId: string, accessToken: string = ''): Promise<CaseContextResult | null> {
        // 1. Fetch Case record
        const caseRecord = await CaseRepository.findById(caseId);
        if (!caseRecord) {
            return null;
        }

        // 2. Fetch Available Tools (exact JSON format used in agent variables)
        let toolsList: any[] = [];
        let toolsSummary = '';
        try {
            const toolRepo = new ToolRepository(pool);
            toolsList = await toolRepo.findByCaseId(caseId);
            if (toolsList && toolsList.length > 0) {
                toolsSummary = JSON.stringify(toolsList);
            }
        } catch (err) {
            console.error('[CaseContextService] Failed to fetch tools for case:', err);
        }
        const availableTools = toolsSummary || 'None';

        // 3. Fetch Available Resources / Documents (exact JSON format used in agent variables)
        let formattedResources: any[] = [];
        let rawResources: any[] = [];
        let resourcesSummary = '';
        let documentsSummary = 'No documents uploaded.';
        if (caseRecord.collection_id) {
            try {
                const resData = await GtwyService.getResourcesByCase(caseRecord.collection_id);
                rawResources = resData?.resources || [];
                if (rawResources.length > 0) {
                    formattedResources = rawResources.map((r: any) => ({
                        resource_id: r._id || r.id || r.resource_id,
                        name: r.title || r.name || 'Untitled',
                        description: r.description || 'No description'
                    }));
                    resourcesSummary = JSON.stringify(formattedResources);
                    documentsSummary = rawResources
                        .map((r: any, i: number) => `${i + 1}. "${r.title || r.name || 'Untitled'}"${r.description ? ` — ${r.description}` : ''}`)
                        .join('\n');
                }
            } catch (err) {
                console.error('[CaseContextService] Failed to fetch resources for case:', err);
            }
        }
        const availableResources = resourcesSummary || 'None';

        // 4. Fetch Hearings
        let hearings: any[] = [];
        let hearingsSummary = 'No hearings recorded.';
        try {
            hearings = await HearingRepository.listByCaseId(caseId);
            if (hearings.length > 0) {
                hearingsSummary = hearings
                    .map((h, i) => {
                        const date = h.date ? new Date(h.date).toLocaleDateString('en-IN', {
                            day: '2-digit', month: 'short', year: 'numeric'
                        }) : 'N/A';
                        return `${i + 1}. Date: ${date} | Status: ${h.status}${h.notes ? ` | Notes: ${h.notes}` : ''}`;
                    })
                    .join('\n');
            }
        } catch (err) {
            console.error('[CaseContextService] Failed to fetch hearings:', err);
        }

        // 5. Fetch Tasks
        let tasks: any[] = [];
        let tasksSummary = 'No tasks or notes recorded.';
        try {
            tasks = await TaskRepository.listByCase(caseId);
            if (tasks.length > 0) {
                tasksSummary = tasks
                    .map((t, i) => {
                        return `${i + 1}. [${t.status}] ${t.title}${t.description ? `: ${t.description}` : ''}${t.due_date ? ` (Due: ${t.due_date})` : ''}`;
                    })
                    .join('\n');
            }
        } catch (err) {
            console.error('[CaseContextService] Failed to fetch tasks:', err);
        }

        // 6. Fetch Case Members
        let members: any[] = [];
        try {
            members = await CaseMemberRepository.listMembers(caseId);
        } catch (err) {
            console.error('[CaseContextService] Failed to fetch members:', err);
        }

        const caseName = caseRecord.title || '';
        const caseDescription = caseRecord.description || '';
        const caseInstructions = caseRecord.instructions || '';
        const collectionId = caseRecord.collection_id || '';
        const caseNumber = caseRecord.case_number || '';
        const court = caseRecord.court || '';
        const caseType = caseRecord.case_type || '';
        const stage = caseRecord.stage || '';
        const judge = caseRecord.judge || '';
        const status = caseRecord.status || '';
        const clientName = caseRecord.client_name || '';
        const opposingParty = caseRecord.opposing_party || '';
        const filingDate = caseRecord.filing_date || '';
        const nextHearingDate = caseRecord.next_hearing_date || '';

        // Flattened variables map
        const variables: Record<string, string> = {
            caseId: caseRecord.id,
            collectionId,
            accessToken,
            caseName,
            caseDescription,
            caseInstructions,
            availableTools,
            availableResources,
            judge: judge || 'N/A',
            court: court || 'N/A',
            caseNumber: caseNumber || 'N/A',
            caseType: caseType || 'N/A',
            stage: stage || 'N/A',
            status,
            clientName: clientName || 'Client',
            opposingParty: opposingParty || 'Opposing Party',
            filingDate: filingDate || 'N/A',
            nextHearingDate: nextHearingDate || 'N/A',
            hearingHistory: hearingsSummary,
            tasksSummary,
            caseDocuments: documentsSummary,
        };

        return {
            caseName,
            caseDescription,
            caseInstructions,
            availableTools,
            availableResources,

            caseId: caseRecord.id,
            collectionId,
            caseNumber,
            court,
            caseType,
            stage,
            judge,
            status,
            clientName,
            opposingParty,
            filingDate,
            nextHearingDate,

            case: caseRecord,
            hearings,
            tasks,
            tools: toolsList,
            documents: rawResources.length > 0 ? rawResources : formattedResources,
            members,

            summaries: {
                hearingsSummary,
                tasksSummary,
                documentsSummary,
                toolsSummary: availableTools,
            },

            variables,
        };
    }
}
