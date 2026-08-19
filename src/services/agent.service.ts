import { GtwyService } from './gtwy.service.js';
import { config } from '../lib/config.js';

export class AgentService {
    static async handleUserMessage(
        caseId: string, 
        threadId: string, 
        userMessage: string,
        variables?: Record<string, string>
    ) {
        // Forward to Gateway API directly, as it acts as the orchestrator itself
        const gtwyResponse = await GtwyService.sendMessage(
            config.GTWY_UNIVERSAL_AGENT_ID, 
            threadId, 
            userMessage,
            variables
        );
        
        // We will process the response format later based on Gateway's tool calling output
        return { success: true, action: 'Gateway Query', response: gtwyResponse };
    }
}
