import { FastifyRequest, FastifyReply } from 'fastify';
import { GtwyService } from '../services/gtwy.service.js';
import { CaseRepository } from '../repositories/case.repository.js';

export const createDocument = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const caseId = req.params.id;
    let title: string = '';
    let type: string = '';
    let contentOrUrl: string = '';
    let isUrl = false;
    
    const caseObj = await CaseRepository.findById(caseId);
    if (!caseObj) return reply.status(404).send({ error: 'Case not found' });
    const targetCollectionId = caseObj.collection_id || caseId;

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
        const resource = await GtwyService.createResource(targetCollectionId, title, contentOrUrl, isUrl);
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
        
        const data = await GtwyService.getResourcesByCase(caseObj.collection_id || caseId);
        return reply.send(data);
    } catch (err: any) {
        return reply.status(500).send({ error: err.message });
    }
};
