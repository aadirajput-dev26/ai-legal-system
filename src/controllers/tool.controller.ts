import { FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import crypto from 'crypto';
import { ToolRepository } from '../repositories/tool.repository.js';
import { CaseRepository } from '../repositories/case.repository.js';
import pool from '../lib/db.js';
import { config } from '../lib/config.js';

export const getViasocketToken = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const caseId = req.params.id;
    const userId = (req as any).user?.userId;

    if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized' });
    }

    try {
        const caseObj = await CaseRepository.findById(caseId);
        if (!caseObj) {
            return reply.status(404).send({ error: 'Case not found' });
        }

        const accessKey = config.VIASOCKET_ACCESS_KEY || 'your_viasocket_access_key';
        const orgId = config.VIASOCKET_ORG_ID || 'your_viasocket_org_id';
        const projectId = config.VIASOCKET_PROJECT_ID || 'your_viasocket_project_id';

        const payload = {
            org_id: orgId,
            project_id: projectId,
            user_id: userId
        };

        const header = {
            alg: 'HS256',
            typ: 'JWT'
        };

        const base64UrlEncode = (str: string) => {
            return Buffer.from(str)
                .toString('base64')
                .replace(/=/g, '')
                .replace(/\+/g, '-')
                .replace(/\//g, '_');
        };

        const headerStr = base64UrlEncode(JSON.stringify(header));
        const payloadStr = base64UrlEncode(JSON.stringify(payload));
        
        const signature = crypto
            .createHmac('sha256', accessKey)
            .update(`${headerStr}.${payloadStr}`)
            .digest('base64')
            .replace(/=/g, '')
            .replace(/\+/g, '-')
            .replace(/\//g, '_');

        const token = `${headerStr}.${payloadStr}.${signature}`;

        return reply.send({ success: true, token });
    } catch (err: any) {
        return reply.status(500).send({ error: err.message });
    }
};

export const createOrUpdateTool = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const caseId = req.params.id;
    const body: any = req.body;
    
    if (!body.script_id) {
        return reply.status(400).send({ error: 'script_id is required' });
    }

    const repo = new ToolRepository(pool);

    try {
        // Try to update first
        let tool = await repo.update(body.script_id, {
            webhook_url: body.webhook_url,
            title: body.title,
            description: body.description,
            openai_tool_json: body.openai_tool_json
        });

        // If not found, create new
        if (!tool) {
            tool = await repo.create({
                case_id: caseId,
                script_id: body.script_id,
                webhook_url: body.webhook_url,
                title: body.title || 'Untitled Tool',
                description: body.description || '',
                openai_tool_json: body.openai_tool_json || {}
            });
        }

        return reply.status(200).send({ success: true, tool });
    } catch (err: any) {
        return reply.status(500).send({ error: err.message });
    }
};

export const deleteTool = async (req: FastifyRequest<{ Params: { id: string, scriptId: string } }>, reply: FastifyReply) => {
    const scriptId = req.params.scriptId;
    
    const repo = new ToolRepository(pool);

    try {
        const deleted = await repo.delete(scriptId);
        if (!deleted) {
            return reply.status(404).send({ error: 'Tool not found' });
        }
        return reply.status(200).send({ success: true });
    } catch (err: any) {
        return reply.status(500).send({ error: err.message });
    }
};

export const listTools = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const caseId = req.params.id;
    
    const repo = new ToolRepository(pool);

    try {
        const tools = await repo.findByCaseId(caseId);
        return reply.send(tools);
    } catch (err: any) {
        return reply.status(500).send({ error: err.message });
    }
};

/**
 * GET /organisations/:orgId/cases/:id/tools/importable
 * Returns all tools across the org that are NOT yet in this case,
 * so the user can pick which ones to import.
 */
export const listImportableTools = async (req: FastifyRequest<{ Params: { id: string; orgId: string } }>, reply: FastifyReply) => {
    const { id: caseId, orgId } = req.params;
    const userId = (req as any).user?.userId;

    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const repo = new ToolRepository(pool);

    try {
        const tools = await repo.findByOrgAndUser(orgId, userId, caseId);
        return reply.send({ success: true, tools });
    } catch (err: any) {
        return reply.status(500).send({ error: err.message });
    }
};

/**
 * POST /cases/:id/tools/import
 * Body: { script_id: string }
 * Copies an existing Viasocket tool from another case into this case.
 * Creates a new row with the same script_id but bound to this case_id.
 */
export const importTool = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const caseId = req.params.id;
    const body: any = req.body;

    if (!body.script_id) {
        return reply.status(400).send({ error: 'script_id is required' });
    }

    const repo = new ToolRepository(pool);

    try {
        // Fetch the source tool by script_id from any case
        const sourceResult = await pool.query(
            'SELECT * FROM tools WHERE script_id = $1 LIMIT 1',
            [body.script_id]
        );
        const source = sourceResult.rows[0];
        if (!source) {
            return reply.status(404).send({ error: 'Tool not found' });
        }

        // Check if already imported into this case
        const existingResult = await pool.query(
            'SELECT id FROM tools WHERE case_id = $1 AND script_id = $2',
            [caseId, body.script_id]
        );
        if (existingResult.rows.length > 0) {
            return reply.status(409).send({ error: 'Tool already exists in this case' });
        }

        // Create a new row for this case with the same script metadata
        const imported = await repo.create({
            case_id: caseId,
            script_id: source.script_id,
            webhook_url: source.webhook_url,
            title: source.title,
            description: source.description,
            openai_tool_json: source.openai_tool_json,
        });

        return reply.status(201).send({ success: true, tool: imported });
    } catch (err: any) {
        return reply.status(500).send({ error: err.message });
    }
};
