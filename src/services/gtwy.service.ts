import { config } from '../lib/config.js';

export class GtwyService {
    static async uploadPdf(fileBuffer: Buffer, filename: string): Promise<string> {
        const formData = new FormData();
        formData.append('file', new Blob([new Uint8Array(fileBuffer)], { type: 'application/pdf' }), filename);

        const response = await fetch('https://api.gtwy.ai/image/processing/upload', {
            method: 'POST',
            headers: {
                'pauthkey': config.PAUTHKEY,
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
            description: description || title,
            ownerId: 'public',
            settings: {
                strategy: 'recursive',
                chunkSize: 1000,
                chunkOverlap: 100
            }
        };

        if (isUrl) {
            payload.url = contentOrUrl;
        } else {
            payload.content = contentOrUrl;
        }

        const url = `${config.HIPPOCAMPUS_HOST_URL}/resource`;
        console.log(`\n--- createResource CURL ---`);
        console.log(`curl -X POST '${url}' -H 'Content-Type: application/json' -H 'x-api-key: REDACTED' -d '${JSON.stringify(payload)}'`);
        console.log(`---------------------------\n`);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': config.GTWY_PAUTHKEY,
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to create resource: ${response.status} ${errorText}`);
        }

        return response.json();
    }

    static async updateResource(resourceId: string, title: string, description?: string, content?: string) {
        const payload: any = { title };
        if (description !== undefined) payload.description = description;
        // Only pass content for TEXT type resources — for PDF/LINK, content is not re-editable
        if (content !== undefined) payload.content = content;

        const url = `${config.HIPPOCAMPUS_HOST_URL}/resource/${resourceId}`;
        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': config.GTWY_PAUTHKEY,
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to update resource: ${response.status} ${errorText}`);
        }

        return response.json();
    }

    /**
     * replaceResourceFast — Atomic Swap for PDF / LINK / TEXT resources.
     *
     * Creates the new resource (triggering fresh vector re-indexing) and
     * immediately returns it. The old resource deletion is fired off as a
     * non-blocking background promise so the HTTP response is instant (<500ms).
     */
    static async replaceResourceFast(
        collectionId: string,
        oldResourceId: string,
        title: string,
        contentOrUrl: string,
        isUrl: boolean,
        description?: string
    ) {
        // Step 1: Create new vector-indexed resource first (safe — old still exists)
        const newResource = await this.createResource(collectionId, title, contentOrUrl, isUrl, description);

        // Step 2: Fire-and-forget cleanup of old stale vectors — does NOT block response
        this.deleteResource(oldResourceId).catch((err) => {
            console.error(`[Background Cleanup] Failed to delete old resource ${oldResourceId}:`, err);
        });

        return newResource;
    }

    static async deleteResource(resourceId: string) {
        const url = `${config.HIPPOCAMPUS_HOST_URL}/resource/${resourceId}`;
        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'x-api-key': config.GTWY_PAUTHKEY,
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to delete resource: ${response.status} ${errorText}`);
        }

        return response.json();
    }

    static async getResource(resourceId: string) {
        const url = `${config.HIPPOCAMPUS_HOST_URL}/resource/${resourceId}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'x-api-key': config.GTWY_PAUTHKEY,
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to fetch resource: ${response.status} ${errorText}`);
        }

        return response.json();
    }

    static async getResourcesByCase(collectionId: string) {
        const url = `${config.HIPPOCAMPUS_HOST_URL}/collection/${collectionId}/resources`;
        
        console.log(`\n--- INTERNAL API CURL ---`);
        console.log(`curl --request GET \\
  --url '${url}' \\
  --header 'x-api-key: REDACTED'`);
        console.log(`-------------------------\n`);

        let retries = 3;
        while (retries > 0) {
            try {
                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'x-api-key': config.GTWY_PAUTHKEY,
                    },
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Failed to get resources: ${response.status} ${errorText}`);
                }

                return await response.json();
            } catch (err: any) {
                retries--;
                if (retries === 0 || !err.message.includes('fetch failed')) {
                    throw err;
                }
                console.log(`Fetch failed, retrying... (${retries} attempts left)`);
                await new Promise(res => setTimeout(res, 1000)); // wait 1s before retry
            }
        }
    }

    static async sendMessageStream(agentId: string, threadId: string, message: string, variables?: Record<string, string>): Promise<Response> {
        const response = await fetch('https://api.gtwy.ai/api/v2/model/chat/completion', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'pauthkey': config.PAUTHKEY,
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
                'pauthkey': config.PAUTHKEY,
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to get thread history: ${response.status} ${errorText}`);
        }

        return response.json();
    }
}
