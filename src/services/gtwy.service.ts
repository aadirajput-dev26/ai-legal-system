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

    static async createResource(collectionId: string, title: string, contentOrUrl: string, isUrl: boolean, description?: string) {
        const payload: any = {
            collectionId: collectionId,
            title: title,
            description: description || title, // fallback to title if no description
            ownerId: 'public'
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
        const url = `${config.HIPPOCAMPUS_HOST_URL}/collection/${collectionId}/resources`;
        
        console.log(`\n--- INTERNAL API CURL ---`);
        console.log(`curl --request GET \\
  --url '${url}' \\
  --header 'pauthkey: ${config.GTWY_PAUTHKEY}'`);
        console.log(`-------------------------\n`);

        const response = await fetch(url, {
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

    static async sendMessage(agentId: string, threadId: string, message: string, variables?: Record<string, string>) {
        const response = await fetch('https://api.gtwy.ai/api/v2/model/chat/completion', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'pauthkey': config.GTWY_PAUTHKEY,
            },
            body: JSON.stringify({
                agent_id: agentId,
                user: message,
                thread_id: threadId,
                variables
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to send message: ${response.status} ${errorText}`);
        }

        return response.json();
    }

    static async sendMessageStream(agentId: string, threadId: string, message: string, variables?: Record<string, string>): Promise<Response> {
        const response = await fetch('https://api.gtwy.ai/api/v2/model/chat/completion', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'pauthkey': config.GTWY_PAUTHKEY,
            },
            body: JSON.stringify({
                agent_id: agentId,
                user: message,
                thread_id: threadId,
                variables,
                stream: true
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to send message: ${response.status} ${errorText}`);
        }

        return response;
    }

    static async getThreadHistory(agentId: string, threadId: string) {
        const response = await fetch(`https://db.gtwy.ai/api/history/${agentId}/${threadId}/${threadId}?page=1&limit=40&user_feedback=all&error=false`, {
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
