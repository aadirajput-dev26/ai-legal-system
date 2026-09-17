import { FastifyRequest, FastifyReply } from 'fastify';
import { ChatThreadRepository } from '../repositories/chat-thread.repository.js';
import { CaseRepository } from '../repositories/case.repository.js';
import { ToolRepository } from '../repositories/tool.repository.js';
import pool from '../lib/db.js';
import { UsageService } from '../services/usage.service.js';
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

        // Extract token
        const authHeader = req.headers.authorization || '';
        const accessToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;

        const toolRepo = new ToolRepository(pool);

        // Run chat verification, case lookup, and tool fetching in parallel
        const [chat, caseRecord, toolsList] = await Promise.all([
            ChatThreadRepository.getById(chatId),
            CaseRepository.findById(caseId),
            toolRepo.findByCaseId(caseId).catch(err => {
                console.error("Failed to fetch tools for variables context:", err);
                return [];
            })
        ]);

        if (!chat) return reply.status(404).send({ error: 'Chat not found' });
        if (!caseRecord) return reply.status(404).send({ error: 'Case not found' });

        const toolsSummary = toolsList && toolsList.length > 0 ? JSON.stringify(toolsList) : '';

        // Fetch resources/documents for case context (cached where possible)
        let resourcesSummary = '';
        if (caseRecord.collection_id) {
            try {
                const resData = await GtwyService.getResourcesByCase(caseRecord.collection_id);
                const resources = resData?.resources || [];
                if (resources.length > 0) {
                    const formattedResources = resources.map((r: any) => ({
                        resource_id: r._id || r.id || r.resource_id,
                        name: r.title || r.name || 'Untitled',
                        description: r.description || 'No description'
                    }));
                    resourcesSummary = JSON.stringify(formattedResources);
                }
            } catch (err) {
                console.error("Failed to fetch resources for variables context:", err);
            }
        }

        // Variables required by GTWY agent tools and personalized context
        const variables = {
            caseId: caseId,
            collectionId: caseRecord.collection_id || '',
            accessToken: accessToken,
            caseName: caseRecord.title || '',
            caseDescription: caseRecord.description || '',
            caseInstructions: caseRecord.instructions || '',
            availableTools: toolsSummary || 'None',
            availableResources: resourcesSummary || 'None'
        };

        // Get the raw SSE stream from GTWY
        const gtwyStream = await AgentService.handleUserMessageStream(caseId, chatId, body.message, variables);

        // Set SSE headers using Fastify (this preserves CORS)
        reply.header('Content-Type', 'text/event-stream');
        reply.header('Cache-Control', 'no-cache');
        reply.header('Connection', 'keep-alive');
        reply.header('X-Accel-Buffering', 'no');

        // Metered passthrough. UsageService forwards every byte to the lawyer
        // FIRST and only then inspects a copy for the `done` event that carries
        // token counts and cost. A metering failure can never cost an answer.
        const metered = UsageService.meterStream(gtwyStream, {
            organisationId: caseRecord.organisation_id,
            userId: (req.user as any)?.userId ?? null,
            caseId,
            feature: 'AI_CHAT',
            resourceId: chatId,
        });

        // Use standard Node stream to ensure Fastify stream pipeline and CORS headers are correctly applied
        const { Readable } = await import('stream');
        return reply.send(Readable.from(metered));
    } catch (error: any) {
        return reply.status(500).send({ error: error.message });
    }
};

