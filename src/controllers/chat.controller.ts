import { FastifyRequest, FastifyReply } from 'fastify';
import { ChatThreadRepository } from '../repositories/chat-thread.repository.js';
import { GtwyService } from '../services/gtwy.service.js';
import { AgentService } from '../services/agent.service.js';

// Reusing the Universal Agent ID
const UNIVERSAL_AGENT_ID = '6a84a7b06245b84a954204c4';

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

        const history = await GtwyService.getThreadHistory(UNIVERSAL_AGENT_ID, chatId);
        return reply.send(history);
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

        // Delegate to Orchestrator Agent
        const result = await AgentService.handleUserMessage(caseId, chatId, body.message);

        return reply.send(result);
    } catch (error: any) {
        return reply.status(500).send({ error: error.message });
    }
};
