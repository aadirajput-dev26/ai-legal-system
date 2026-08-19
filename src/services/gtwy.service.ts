import { config } from '../lib/config.js';

export class GtwyService {
    static async uploadPdf(fileBuffer: Buffer, filename: string): Promise<string> {
        const formData = new FormData();
        formData.append('file', new Blob([new Uint8Array(fileBuffer)], { type: 'application/pdf' }), filename);

        const response = await fetch('https://api.gtwy.ai/image/processing/upload', {
            method: 'POST',
            headers: {
                'pauthkey': config.GTWY_PAUTHKEY,
            },
            body: formData,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to upload PDF: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        if (!data.success || !data.file_url) {
            throw new Error('Upload response missing file_url');
        }

        return data.file_url;
    }

    static async createResource(caseId: string, title: string, contentOrUrl: string, isUrl: boolean) {
        const payload: any = {
            collectionId: caseId,
            title: title,
            ownerId: 'public',
            settings: {
                strategy: 'custom',
                chunkingUrl: 'https://your-chunking-url/'
            }
        };

        if (isUrl) {
            payload.url = contentOrUrl;
        } else {
            payload.content = contentOrUrl;
        }

        const response = await fetch(`${config.HIPPOCAMPUS_HOST_URL}/resource`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'pauthkey': config.GTWY_PAUTHKEY,
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to create resource: ${response.status} ${errorText}`);
        }

        return response.json();
    }

    static async getResourcesByCase(collectionId: string) {
        const response = await fetch(`https://api.gtwy.ai/collection/${collectionId}/resources`, {
            method: 'GET',
            headers: {
                'pauthkey': config.GTWY_PAUTHKEY,
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to get resources: ${response.status} ${errorText}`);
        }

        return response.json();
    }

    static async sendMessage(agentId: string, threadId: string, message: string) {
        const response = await fetch('https://api.gtwy.ai/api/v2/model/chat/completion', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'pauthkey': config.GTWY_PAUTHKEY,
            },
            body: JSON.stringify({
                agent_id: agentId,
                user: message,
                thread_id: threadId
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to send message: ${response.status} ${errorText}`);
        }

        return response.json();
    }

    static async getThreadHistory(agentId: string, threadId: string) {
        const response = await fetch(`https://api.gtwy.ai/api/history/${agentId}/${threadId}`, {
            method: 'GET',
            headers: {
                'pauthkey': config.GTWY_PAUTHKEY,
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to get thread history: ${response.status} ${errorText}`);
        }

        return response.json();
    }
}
