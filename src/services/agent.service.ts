import { GtwyService } from './gtwy.service.js';
import { config } from '../lib/config.js';

export class AgentService {
    static async handleUserMessageStream(
        caseId: string,
        threadId: string,
        userMessage: string,
        variables?: Record<string, string>,
        environment?: 'dev' | 'production'
    ): Promise<Response> {
        return GtwyService.sendMessageStream(
            config.GTWY_UNIVERSAL_AGENT_ID,
            threadId,
            userMessage,
            variables,
            environment || config.ENVIRONMENT
        );
    }
}
