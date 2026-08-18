import { GtwyService } from './gtwy.service.js';

// Gateway universal agent provided by the user
const UNIVERSAL_AGENT_ID = '6a84a7b06245b84a954204c4';

export class AgentService {
    static async handleUserMessage(caseId: string, threadId: string, userMessage: string) {
        // Forward to Gateway API directly, as it acts as the orchestrator itself
        const gtwyResponse = await GtwyService.sendMessage(UNIVERSAL_AGENT_ID, threadId, userMessage);
        
        // We will process the response format later based on Gateway's tool calling output
        return { success: true, action: 'Gateway Query', response: gtwyResponse };
    }
}
