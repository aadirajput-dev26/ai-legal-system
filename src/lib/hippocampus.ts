import { config } from './config.js';

/**
 * hippocampus.ts — HTTP client for the Hippocampus RAG service.
 *
 * All Hippocampus API calls are centralised here so that:
 * - Auth headers are injected in one place.
 * - The base URL is configurable via environment variable.
 * - Other services can import clean, typed functions without
 *   knowing about raw fetch() details.
 */

const BASE_URL = config.HIPPOCAMPUS_HOST_URL;
const HEADERS = {
    'Content-Type': 'application/json',
    'x-api-key': config.GTWY_PAUTHKEY,
};

export interface HippocampusCollection {
    collection_id: string;   // This is data.hippocampus_response._id — the actual Hippocampus vector DB collection ID
    name: string;
    created_at: string;
}

// ─────────────────────────────────────────────
// Create a new collection in Hippocampus for a case
// ─────────────────────────────────────────────
export async function createCollection(caseName: string): Promise<HippocampusCollection> {
    const response = await fetch(`${BASE_URL}/collection`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
            name: caseName,
            settings: {
                denseModel: 'BAAI/bge-large-en-v1.5',
                sparseModel: 'Qdrant/bm25',
                rerankerModel: 'colbert-ir/colbertv2.0',
                chunkSize: 1000,
                chunkOverlap: 100,
            },
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Hippocampus createCollection failed [${response.status}]: ${body}`);
    }

    const json = await response.json() as {
        _id: string;
        name: string;
        createdAt?: string;
        created_at?: string;
    };

    const hippocampusId = json._id;
    return {
        collection_id: hippocampusId,
        name: json.name,
        created_at: json.createdAt || json.created_at || new Date().toISOString(),
    };
}

// ─────────────────────────────────────────────
// Delete a collection from Hippocampus (called on case deletion)
// ─────────────────────────────────────────────
export async function deleteCollection(collectionId: string): Promise<void> {
    const response = await fetch(`${BASE_URL}/collection/${collectionId}`, {
        method: 'DELETE',
        headers: HEADERS,
    });

    if (!response.ok) {
        // Log but don't throw — case deletion should not be blocked by Hippocampus errors
        console.error(`Hippocampus deleteCollection failed [${response.status}] for id=${collectionId}`);
    }
}
