import { GtwyService } from './gtwy.service.js';
import { DraftContextService } from './draft-context.service.js';
import { DraftRepository } from '../repositories/draft.repository.js';
import { config } from '../lib/config.js';
import type { DraftType } from '../repositories/draft.repository.js';

export class DraftService {
    /**
     * Aggregates case context and streams an AI-generated draft from GTWY.
     * Returns the raw streaming Response for the controller to pipe to the client.
     */
    static async generateDraftStream(
        caseId: string,
        draftType: DraftType,
        draftInstructions: string,
        accessToken: string,
        threadId: string
    ): Promise<Response> {
        // 1. Build full case context
        const ctx = await DraftContextService.buildContext(caseId);

        // 2. Convert to GTWY variables
        const variables = DraftContextService.toVariables(ctx, draftType, draftInstructions, accessToken);

        // 3. Build the AI prompt message
        const draftTypeLabel = draftType.replace(/_/g, ' ').toLowerCase()
            .replace(/\b\w/g, c => c.toUpperCase());

        const userMessage = `You are an expert Indian legal drafter. Generate a professional ${draftTypeLabel} for the following case.

=== CASE CONTEXT ===
Case Name: ${ctx.caseName}
Case Number: ${ctx.caseNumber || 'N/A'}
Court: ${ctx.court || 'N/A'}
Case Type: ${ctx.caseType || 'N/A'}
Stage: ${ctx.stage || 'N/A'}
Judge: ${ctx.judge || 'N/A'}
Filing Date: ${ctx.filingDate || 'N/A'}

Client / Petitioner: ${ctx.clientName || 'Client'}
Opposite Party / Respondent: ${ctx.opposingParty || 'Opposite Party'}

Case Description:
${ctx.description || 'Not provided'}

Case Instructions / Background:
${ctx.instructions || 'None'}

=== HEARING HISTORY ===
${ctx.hearingsSummary}

=== TASKS & NOTES ===
${ctx.tasksSummary}

=== UPLOADED DOCUMENTS ===
${ctx.documentsSummary}

=== DRAFT INSTRUCTIONS ===
Draft Type: ${draftTypeLabel}
Special Instructions: ${draftInstructions || 'None — generate a standard, complete draft.'}

Generate the complete ${draftTypeLabel} now. Follow proper Indian legal formatting, include all legally required sections, cite relevant Indian statutes and provisions where applicable. Output the full document in Markdown format.`;

        // 4. Stream the generation
        return GtwyService.sendMessageStream(
            config.GTWY_UNIVERSAL_AGENT_ID,
            threadId,
            userMessage,
            variables
        );
    }

    /**
     * Streams an AI refinement of a specific section or the full draft.
     * The lawyer provides a prompt describing what change to make.
     */
    static async refineDraftStream(
        caseId: string,
        currentContent: string,
        refinementPrompt: string,
        selectedText: string | undefined,
        accessToken: string,
        threadId: string
    ): Promise<Response> {
        const ctx = await DraftContextService.buildContext(caseId);
        const variables = DraftContextService.toVariables(ctx, 'OTHER', refinementPrompt, accessToken);

        let userMessage: string;

        if (selectedText) {
            userMessage = `You are an expert Indian legal drafter. The lawyer has selected a specific section of a legal document and wants you to refine it.

=== FULL DRAFT (for context) ===
${currentContent}

=== SELECTED TEXT TO REFINE ===
${selectedText}

=== REFINEMENT INSTRUCTION ===
${refinementPrompt}

Please output ONLY the refined replacement text for the selected section. Do not include the rest of the document — output only what should replace the selected text.`;
        } else {
            userMessage = `You are an expert Indian legal drafter. The lawyer wants to refine the following legal document.

=== CURRENT DRAFT ===
${currentContent}

=== REFINEMENT INSTRUCTION ===
${refinementPrompt}

Please output the COMPLETE refined document in Markdown format, incorporating the requested changes while preserving all other sections.`;
        }

        return GtwyService.sendMessageStream(
            config.GTWY_UNIVERSAL_AGENT_ID,
            threadId,
            userMessage,
            variables
        );
    }
}
