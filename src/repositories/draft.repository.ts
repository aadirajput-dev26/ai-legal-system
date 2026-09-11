import pool from '../lib/db.js';

// ── Types ──────────────────────────────────────────────────────────

export type DraftType =
    | 'LEGAL_NOTICE'
    | 'APPLICATION'
    | 'AFFIDAVIT'
    | 'REPLY'
    | 'EMAIL'
    | 'WHATSAPP'
    | 'COURT_DRAFT'
    | 'CORRESPONDENCE'
    | 'OTHER';

export type DraftStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED';

export type VersionChangeType = 'AI_GENERATION' | 'AI_REFINEMENT' | 'MANUAL_SAVE';

export interface DraftRow {
    id: string;
    case_id: string;
    title: string;
    description: string | null;
    draft_type: DraftType;
    status: DraftStatus;
    instructions: string | null;
    current_content: string;
    created_by: string | null;
    created_at: string;
    updated_at: string;
    case_title?: string;
    case_number?: string | null;
    court?: string | null;
}

export interface DraftVersionRow {
    id: string;
    draft_id: string;
    version_number: number;
    content: string;
    change_type: VersionChangeType;
    prompt_used: string | null;
    created_at: string;
}

export interface CreateDraftParams {
    caseId: string;
    title: string;
    description?: string;
    draftType?: DraftType;
    instructions?: string;
    createdBy: string;
}

export interface UpdateDraftParams {
    title?: string;
    description?: string;
    status?: DraftStatus;
    instructions?: string;
    currentContent?: string;
}

// ── Repository ────────────────────────────────────────────────────

export class DraftRepository {
    static async listByOrgAndUser(orgId: string, userId: string): Promise<DraftRow[]> {
        const result = await pool.query<DraftRow>(
            `SELECT d.id, d.case_id, d.title, d.description, d.draft_type, d.status, d.instructions,
                    d.current_content, d.created_by, d.created_at, d.updated_at,
                    c.title as case_title, c.case_number, c.court
             FROM drafts d
             JOIN cases c ON c.id = d.case_id
             WHERE c.organisation_id = $1
               AND (
                 EXISTS (SELECT 1 FROM case_members cm WHERE cm.case_id = c.id AND cm.user_id = $2)
                 OR EXISTS (SELECT 1 FROM organisation_members om WHERE om.organisation_id = $1 AND om.user_id = $2 AND om.role IN ('OWNER', 'ADMIN'))
               )
             ORDER BY d.updated_at DESC`,
            [orgId, userId]
        );
        return result.rows;
    }

    static async listByCase(caseId: string): Promise<DraftRow[]> {
        const result = await pool.query<DraftRow>(
            `SELECT id, case_id, title, description, draft_type, status, instructions,
                    current_content, created_by, created_at, updated_at
             FROM drafts
             WHERE case_id = $1
             ORDER BY created_at DESC`,
            [caseId]
        );
        return result.rows;
    }

    static async findById(draftId: string): Promise<DraftRow | null> {
        const result = await pool.query<DraftRow>(
            `SELECT id, case_id, title, description, draft_type, status, instructions,
                    current_content, created_by, created_at, updated_at
             FROM drafts
             WHERE id = $1`,
            [draftId]
        );
        return result.rows[0] || null;
    }

    static async create(params: CreateDraftParams): Promise<DraftRow> {
        const result = await pool.query<DraftRow>(
            `INSERT INTO drafts (case_id, title, description, draft_type, instructions, created_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, case_id, title, description, draft_type, status, instructions,
                       current_content, created_by, created_at, updated_at`,
            [
                params.caseId,
                params.title,
                params.description ?? null,
                params.draftType ?? 'OTHER',
                params.instructions ?? null,
                params.createdBy,
            ]
        );
        return result.rows[0];
    }

    static async update(draftId: string, updates: UpdateDraftParams): Promise<DraftRow | null> {
        const fields: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (updates.title != null) { fields.push(`title = $${idx++}`); values.push(updates.title); }
        if (updates.description != null) { fields.push(`description = $${idx++}`); values.push(updates.description); }
        if (updates.status != null) { fields.push(`status = $${idx++}`); values.push(updates.status); }
        if (updates.instructions != null) { fields.push(`instructions = $${idx++}`); values.push(updates.instructions); }
        if (updates.currentContent != null) { fields.push(`current_content = $${idx++}`); values.push(updates.currentContent); }

        if (fields.length === 0) return null;

        fields.push(`updated_at = NOW()`);
        values.push(draftId);

        const result = await pool.query<DraftRow>(
            `UPDATE drafts SET ${fields.join(', ')} WHERE id = $${idx}
             RETURNING id, case_id, title, description, draft_type, status, instructions,
                       current_content, created_by, created_at, updated_at`,
            values
        );
        return result.rows[0] || null;
    }

    static async delete(draftId: string): Promise<boolean> {
        const result = await pool.query('DELETE FROM drafts WHERE id = $1', [draftId]);
        return (result.rowCount ?? 0) > 0;
    }

    // ── Version History ────────────────────────────────────────────

    static async getVersions(draftId: string): Promise<DraftVersionRow[]> {
        const result = await pool.query<DraftVersionRow>(
            `SELECT id, draft_id, version_number, content, change_type, prompt_used, created_at
             FROM draft_versions
             WHERE draft_id = $1
             ORDER BY version_number DESC`,
            [draftId]
        );
        return result.rows;
    }

    static async saveVersion(
        draftId: string,
        content: string,
        changeType: VersionChangeType,
        promptUsed?: string
    ): Promise<DraftVersionRow> {
        // Auto-increment version number
        const countRes = await pool.query<{ count: string }>(
            'SELECT COUNT(*) as count FROM draft_versions WHERE draft_id = $1',
            [draftId]
        );
        const nextVersion = parseInt(countRes.rows[0].count) + 1;

        const result = await pool.query<DraftVersionRow>(
            `INSERT INTO draft_versions (draft_id, version_number, content, change_type, prompt_used)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, draft_id, version_number, content, change_type, prompt_used, created_at`,
            [draftId, nextVersion, content, changeType, promptUsed ?? null]
        );
        return result.rows[0];
    }
}
