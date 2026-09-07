import { config } from '../lib/config.js';

export interface LegalUpdate {
    id: string;
    type: string;
    title: string;
    summary: string;
    source: string;
    date: string | null;
    source_key: string;
}

export class LegalUpdateService {
    // In-memory cache for legal updates
    private static updatesCache: LegalUpdate[] = [];

    /**
     * Generates a concise, lawyer-friendly summary based on the update type and title.
     */
    private static generateSummary(type: string, title: string): string {
        const lowerTitle = title.toLowerCase();
        if (type === 'Act') {
            return `A new Act regarding '${title}' was recently enacted. This may introduce substantive procedural or compliance changes.`;
        }
        if (type === 'Rule') {
            return `New rules introduced related to '${title}', affecting compliance requirements under the applicable framework.`;
        }
        if (type === 'Notification' || type === 'Regulation') {
            if (lowerTitle.includes('amendment')) {
                return `A recent ${type.toLowerCase()} introduces amendments that may impact administrative procedures or specific regulatory compliance.`;
            }
            return `A recent ${type.toLowerCase()} introduces changes relevant to administrative procedures and specific compliance frameworks.`;
        }
        if (type === 'Ordinance') {
            return `A new Ordinance has been promulgated: '${title}'. This introduces immediate legal changes pending legislative approval.`;
        }
        return `A recent legal instrument has been published. This may impact how the parent framework is implemented.`;
    }

    private static capitalize(str: string): string {
        if (!str) return 'Legal Update';
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    /**
     * Fetches and refreshes the legal updates from India Code APIs.
     * Stores them in memory.
     */
    static async refreshUpdates(): Promise<void> {
        console.log('[LegalUpdateService] Starting daily refresh of legal updates...');
        const headers = { 'x-api-key': config.GTWY_PAUTHKEY };
        const newUpdates: LegalUpdate[] = [];

        try {
            // 1. Fetch recent Acts
            const actsRes = await fetch("https://indiacode.ecourtsindia.com/api/v1/acts?limit=25", { headers });
            if (actsRes.ok) {
                const actsData = await actsRes.json();
                const acts = actsData.acts || [];
                for (const act of acts) {
                    const title = act.short_title || act.id || 'Untitled Act';
                    newUpdates.push({
                        id: `act_${act.id}`,
                        type: 'Act',
                        title: title,
                        summary: this.generateSummary('Act', title),
                        source: 'India Code',
                        date: act.enact_date ? act.enact_date : null,
                        source_key: `act_${act.id}`
                    });
                }
            } else {
                console.warn('[LegalUpdateService] Failed to fetch acts:', actsRes.statusText);
            }

            // 2. Fetch recent Instruments
            const instRes = await fetch("https://indiacode.ecourtsindia.com/api/v1/instruments?limit=25", { headers });
            if (instRes.ok) {
                const instData = await instRes.json();
                const instruments = instData.instruments || [];
                for (const inst of instruments) {
                    const typeStr = this.capitalize(inst.kind || 'instrument');
                    const title = inst.title || 'Untitled Instrument';
                    const date = inst.year ? `${inst.year}-01-01` : null;
                    
                    newUpdates.push({
                        id: `inst_${inst.key}`,
                        type: typeStr,
                        title: title,
                        summary: this.generateSummary(typeStr, title),
                        source: 'India Code',
                        date: date,
                        source_key: `inst_${inst.key}`
                    });
                }
            } else {
                console.warn('[LegalUpdateService] Failed to fetch instruments:', instRes.statusText);
            }

            // Update the cache if we got new data
            if (newUpdates.length > 0) {
                this.updatesCache = newUpdates;
                console.log(`[LegalUpdateService] Successfully refreshed in-memory cache with ${newUpdates.length} legal updates.`);
            }

        } catch (error) {
            console.error('[LegalUpdateService] Error during legal update refresh:', error);
        }
    }

    /**
     * Get up to `count` random updates from the cache.
     */
    static getRandomUpdates(count: number = 5): LegalUpdate[] {
        if (this.updatesCache.length === 0) return [];
        
        // Shuffle array using Fisher-Yates approach instead of just random sort
        const shuffled = [...this.updatesCache];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        
        return shuffled.slice(0, count);
    }
}
