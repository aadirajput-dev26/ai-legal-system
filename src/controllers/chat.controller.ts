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
        const chat = await ChatThreadRepository.getById(chatId);
        if (!chat) return reply.status(404).send({ error: 'Chat not found' });

        const history = await GtwyService.getThreadHistory(config.GTWY_UNIVERSAL_AGENT_ID, chatId);

        // GTWY history: { data: Array<{ user, llm_message, tools_call_data, created_at }> }
        const entries: any[] = Array.isArray(history) ? history : (history.data || []);

        const messages: { role: string; content: string }[] = [];
        for (const entry of entries) {
            if (entry.user) {
                messages.push({ role: 'user', content: entry.user });
            }
            if (entry.llm_message) {
                messages.push({ role: 'assistant', content: entry.llm_message });
            }
        }

        return reply.send({ success: true, data: messages });
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

        // Fetch the case to get context
        const caseRecord = await CaseRepository.findById(caseId);
        if (!caseRecord) return reply.status(404).send({ error: 'Case not found' });

        // Extract token
        const authHeader = req.headers.authorization || '';
        const accessToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;

        // Variables required by GTWY agent tools and personalized context
        const variables = {
            caseId: caseId,
            case_id: caseId,
            collectionId: caseRecord.collection_id || '',
            collection_id: caseRecord.collection_id || '',
            accessToken: accessToken,
            access_token: accessToken,
            caseName: caseRecord.title || '',
            case_name: caseRecord.title || '',
            caseDescription: caseRecord.description || '',
            case_description: caseRecord.description || '',
            caseInstructions: caseRecord.instructions || '',
            case_instructions: caseRecord.instructions || ''
        };

        // Get the raw SSE stream from GTWY
        const gtwyStream = await AgentService.handleUserMessageStream(caseId, chatId, body.message, variables);

        // Set SSE headers using Fastify (this preserves CORS)
        reply.header('Content-Type', 'text/event-stream');
        reply.header('Cache-Control', 'no-cache');
        reply.header('Connection', 'keep-alive');
        reply.header('X-Accel-Buffering', 'no');

        // Fastify natively supports Node streams. We convert the Web Stream AsyncIterable to a Node stream.
        async function* streamGenerator() {
            const reader = gtwyStream.body!.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    // Fastify expects Buffer or string in streams
                    yield Buffer.from(value);
                }
            } finally {
                reader.releaseLock();
            }
        }

        // Use standard Node stream to ensure Fastify stream pipeline and CORS headers are correctly applied
        const { Readable } = await import('stream');
        return reply.send(Readable.from(streamGenerator()));
    } catch (error: any) {
        return reply.status(500).send({ error: error.message });
    }
};
