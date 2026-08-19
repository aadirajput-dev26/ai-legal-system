import { FastifyRequest, FastifyReply } from 'fastify';
import { ChatThreadRepository } from '../repositories/chat-thread.repository.js';
import { CaseRepository } from '../repositories/case.repository.js';
import { GtwyService } from '../services/gtwy.service.js';
import { AgentService } from '../services/agent.service.js';
import { config } from '../lib/config.js';

export const createChat = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
        const caseId = req.params.id;
        const body = req.body as { title: string };
        const title = body?.title || 'New Chat';

        const chat = await ChatThreadRepository.create(caseId, title);
        return reply.status(201).send({ success: true, chat });
    } catch (error: any) {
        return reply.status(500).send({ error: error.message });
    }
};

export const listChats = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
        const caseId = req.params.id;
        const chats = await ChatThreadRepository.listByCaseId(caseId);
        return reply.send({ success: true, chats });
    } catch (error: any) {
        return reply.status(500).send({ error: error.message });
    }
};

export const getChatHistory = async (req: FastifyRequest<{ Params: { id: string, chatId: string } }>, reply: FastifyReply) => {
    try {
        const { chatId } = req.params;
        // Verify chat exists
        const chat = await ChatThreadRepository.getById(chatId);
        if (!chat) return reply.status(404).send({ error: 'Chat not found' });

        const history = await GtwyService.getThreadHistory(config.GTWY_UNIVERSAL_AGENT_ID, chatId);
        // Format history for the client. The frontend expects res.data to be an array of { role, content }
        const messages = Array.isArray(history) ? history : (history.data || history.messages || []);
        const formattedMessages = messages.map((m: any) => ({
            role: m.role || (m.type === 'human' ? 'user' : 'assistant'),
            content: m.content || m.text || ''
        }));
        return reply.send({ success: true, data: formattedMessages });
    } catch (error: any) {
        return reply.status(500).send({ error: error.message });
    }
};

export const sendMessage = async (req: FastifyRequest<{ Params: { id: string, chatId: string } }>, reply: FastifyReply) => {
    try {
        const { id: caseId, chatId } = req.params;
        const body = req.body as { message: string };
        
        if (!body?.message) return reply.status(400).send({ error: 'Message is required' });

        const chat = await ChatThreadRepository.getById(chatId);
        if (!chat) return reply.status(404).send({ error: 'Chat not found' });

        // Fetch the case to get the collection_id
        const caseRecord = await CaseRepository.findById(caseId);
        if (!caseRecord) return reply.status(404).send({ error: 'Case not found' });

        // Extract token
        const authHeader = req.headers.authorization || '';
        const accessToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;

        // Variables required by GTWY agent tools and personalized context
        const variables = {
            caseId: caseId,
            collectionId: caseRecord.collection_id || '',
            accessToken: accessToken,
            caseName: caseRecord.title || '',
            caseDescription: caseRecord.description || '',
            caseInstructions: caseRecord.instructions || ''
        };

        // Delegate to Orchestrator Agent
        const result = await AgentService.handleUserMessage(caseId, chatId, body.message, variables);

        return reply.send(result);
    } catch (error: any) {
        return reply.status(500).send({ error: error.message });
    }
};
