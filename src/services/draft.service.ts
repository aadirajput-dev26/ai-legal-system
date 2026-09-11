import { GtwyService } from './gtwy.service.js';
import { config } from '../lib/config.js';
import type { DraftType } from '../repositories/draft.repository.js';

export class DraftService {
    private static getAgentId(): string {
        return config.GTWY_DRAFT_AGENT_ID || '6aa3f0a03e5db27e9a0661e4';
    }

    /**
     * Streams an AI-generated draft from GTWY agent 6aa3f0a03e5db27e9a0661e4.
     * Passes caseId and draft variables.
     */
    static async generateDraftStream(
        caseId: string,
        draftType: DraftType,
        draftInstructions: string,
        accessToken: string,
        threadId: string
    ): Promise<Response> {
        const draftTypeLabel = draftType.replace(/_/g, ' ').toLowerCase()
            .replace(/\b\w/g, c => c.toUpperCase());

        const variables: Record<string, string> = {
            caseId,
            accessToken,
            draftType: draftTypeLabel,
            draftInstructions: draftInstructions || '',
        };

        const userMessage = draftInstructions && draftInstructions.trim()
            ? `Generate a professional ${draftTypeLabel} for this case. Specific instructions: ${draftInstructions}`
            : `Generate a professional ${draftTypeLabel} for this case. Follow standard Indian legal notice/draft formatting, include all legal grounds, relief sought, demand timeline, reserved rights, and placeholder fields in brackets (e.g. [Date], [Accused Name], [Deceased Name], [Address], [Location], [Age], [Beneficiary details], [Court], etc.) where appropriate particulars are to be filled.`;

        return GtwyService.sendMessageStream(
            this.getAgentId(),
            threadId,
            userMessage,
            variables
        );
    }

    /**
     * Streams an AI refinement or conversational update for a draft document.
     * Uses GTWY agent 6aa3f0a03e5db27e9a0661e4 with caseId, currentDocument, and user instruction.
     */
    static async refineDraftStream(
        caseId: string,
        currentContent: string,
        refinementPrompt: string,
        selectedText: string | undefined,
        accessToken: string,
        threadId: string
    ): Promise<Response> {
        const variables: Record<string, string> = {
            caseId,
            accessToken,
            instruction: refinementPrompt,
            currentDocument: currentContent,
        };

        let userMessage: string;

        if (selectedText && selectedText.trim()) {
            userMessage = `The lawyer has selected the following text in the legal draft to refine:
"""
${selectedText}
"""

Instruction: ${refinementPrompt}

Full document for context:
${currentContent}

Output the refined replacement text for the selected section.`;
        } else {
            userMessage = `Current Draft Document:
${currentContent}

Lawyer's Instruction:
${refinementPrompt}

Please update the document according to the instruction while maintaining legal precision, formal formatting, and consistent placeholder fields. Output the revised document.`;
        }

        return GtwyService.sendMessageStream(
            this.getAgentId(),
            threadId,
            userMessage,
            variables
        );
    }
}
