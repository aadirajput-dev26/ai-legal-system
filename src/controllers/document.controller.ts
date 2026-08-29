import { FastifyRequest, FastifyReply } from 'fastify';
import { GtwyService } from '../services/gtwy.service.js';
import { CaseRepository } from '../repositories/case.repository.js';

export const createDocument = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const caseId = req.params.id;
    let title: string = '';
    let type: string = '';
    let contentOrUrl: string = '';
    let description: string = '';
    let isUrl = false;
    
    const caseObj = await CaseRepository.findById(caseId);
    if (!caseObj) return reply.status(404).send({ error: 'Case not found' });
    if (!caseObj.collection_id) {
        return reply.status(400).send({ error: 'Case has no Hippocampus collection mapped to it. Please recreate the case.' });
    }
    const targetCollectionId = caseObj.collection_id;

    if (req.isMultipart()) {
        const parts = req.parts();
        let fileBuffer: Buffer | null = null;
        let filename: string = '';

        for await (const part of parts) {
            if (part.type === 'file' && part.fieldname === 'file') {
                fileBuffer = await part.toBuffer();
                filename = part.filename;
            } else if (part.type === 'field') {
                if (part.fieldname === 'title') title = part.value as string;
                if (part.fieldname === 'type') type = part.value as string;
                if (part.fieldname === 'description') description = part.value as string;
            }
        }
        
        if (type !== 'PDF') return reply.status(400).send({ error: 'Multipart is only for PDF type' });
        if (!fileBuffer) return reply.status(400).send({ error: 'No file uploaded' });
        if (!title) return reply.status(400).send({ error: 'Title is required' });

        try {
            const fileUrl = await GtwyService.uploadPdf(fileBuffer, filename);
            contentOrUrl = fileUrl;
            isUrl = true;
        } catch (err: any) {
            return reply.status(500).send({ error: err.message });
        }
    } else {
        const body: any = req.body;
        title = body.title;
        type = body.type;
        description = body.description || '';
        
        if (!title || !type) {
            return reply.status(400).send({ error: 'Title and type are required' });
        }
        
        if (type === 'LINK') {
            if (!body.url) return reply.status(400).send({ error: 'URL is required for LINK type' });
            contentOrUrl = body.url;
            isUrl = true;
        } else if (type === 'TEXT') {
            if (!body.content) return reply.status(400).send({ error: 'Content is required for TEXT type' });
            contentOrUrl = body.content;
            isUrl = false;
        } else {
            return reply.status(400).send({ error: 'Invalid type or missing multipart for PDF' });
        }
    }

    try {
        const resource = await GtwyService.createResource(targetCollectionId, title, contentOrUrl, isUrl, description);
        return reply.status(201).send({ success: true, resource });
    } catch (err: any) {
        return reply.status(500).send({ error: err.message });
    }
};

export const listDocuments = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
        const caseId = req.params.id;
        const caseObj = await CaseRepository.findById(caseId);
        if (!caseObj) return reply.status(404).send({ error: 'Case not found' });
        if (!caseObj.collection_id) {
            return reply.status(400).send({ error: 'Case has no Hippocampus collection mapped to it. Please recreate the case.' });
        }
        
        const data = await GtwyService.getResourcesByCase(caseObj.collection_id);
        return reply.send({ success: true, data: data });
    } catch (err: any) {
        return reply.status(500).send({ error: err.message });
    }
};

export const updateDocument = async (req: FastifyRequest<{ Params: { id: string; resourceId: string } }>, reply: FastifyReply) => {
    try {
        const { id: caseId, resourceId } = req.params;
        const body = req.body as { title?: string; description?: string; type?: string; content?: string };

        if (!body.title?.trim()) {
            return reply.status(400).send({ error: 'Title is required' });
        }

        // Verify case exists (auth is already handled by middleware)
        const caseObj = await CaseRepository.findById(caseId);
        if (!caseObj) return reply.status(404).send({ error: 'Case not found' });

        // Only pass content if this is a TEXT resource — PDF and LINK content is not editable
        const contentToUpdate = body.type === 'TEXT' ? body.content?.trim() : undefined;

        const updated = await GtwyService.updateResource(resourceId, body.title.trim(), body.description?.trim(), contentToUpdate);
        return reply.send({ success: true, resource: updated });
    } catch (err: any) {
        return reply.status(500).send({ error: err.message });
    }
};

export const deleteDocument = async (req: FastifyRequest<{ Params: { id: string; resourceId: string } }>, reply: FastifyReply) => {
    try {
        const { id: caseId, resourceId } = req.params;

        const caseObj = await CaseRepository.findById(caseId);
        if (!caseObj) return reply.status(404).send({ error: 'Case not found' });

        const result = await GtwyService.deleteResource(resourceId);
        return reply.send({ success: true, result });
    } catch (err: any) {
        return reply.status(500).send({ error: err.message });
    }
};
