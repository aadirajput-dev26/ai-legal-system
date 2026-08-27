import pool from '../lib/db.js';

export interface CaseRow {
    id: string;
    title: string;
    status: string;
    collection_id: string;
}

export interface CaseWithRoleRow {
    id: string;
    title: string;
    status: string;
    case_number: string | null;
    court: string | null;
    next_hearing_date: string | null;
    created_at: string;
    role: string;
}

export interface CaseDetailsRow {
    id: string;
    organisation_id: string;
    title: string;
    description: string | null;
    status: string;
    case_number: string | null;
    court: string | null;
    case_type: string | null;
    instructions: string | null;
    collection_id: string | null;
    filing_date: string | null;
    next_hearing_date: string | null;
    created_at: string;
    updated_at: string;
}

export interface UpdateCaseParams {
    title?: string;
    description?: string;
    status?: string;
    court?: string;
    case_number?: string;
    case_type?: string;
    instructions?: string;
    next_hearing_date?: string;
}

export interface CaseUpdateResultRow {
    id: string;
    title: string;
    status: string;
    case_number: string | null;
    court: string | null;
    instructions: string | null;
    next_hearing_date: string | null;
    updated_at: string;
}

export class CaseRepository {
    static async listByUserAndOrg(orgId: string, userId: string): Promise<CaseWithRoleRow[]> {
        const result = await pool.query<CaseWithRoleRow>(
            `SELECT c.id, c.title, c.status, c.case_number, c.court,
                    c.next_hearing_date, c.created_at, COALESCE(cm.role, 'ADMIN') as role
             FROM cases c
             JOIN organisation_members om ON c.organisation_id = om.organisation_id AND om.user_id = $2
             LEFT JOIN case_members cm ON cm.case_id = c.id AND cm.user_id = $2
             WHERE c.organisation_id = $1 
               AND (om.role = 'ADMIN' OR cm.user_id IS NOT NULL)
             ORDER BY c.created_at DESC`,
            [orgId, userId]
        );
        return result.rows;
    }

    static async create(params: {
        organisationId: string;
        collectionId: string;
        title: string;
        description?: string | null;
        caseNumber?: string | null;
        court?: string | null;
        caseType?: string | null;
        instructions?: string | null;
        filingDate?: string | null;
        userId: string;
    }): Promise<CaseRow> {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const caseResult = await client.query<CaseRow>(
                `INSERT INTO cases
                    (organisation_id, collection_id, title, description, case_number, court, case_type, instructions, filing_date)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 RETURNING id, title, status, collection_id`,
                [
                    params.organisationId,
                    params.collectionId,
                    params.title,
                    params.description ?? null,
                    params.caseNumber ?? null,
                    params.court ?? null,
                    params.caseType ?? null,
                    params.instructions ?? null,
                    params.filingDate ?? null,
                ]
            );

            const newCase = caseResult.rows[0];

            await client.query(
                `INSERT INTO case_members (case_id, user_id, role) VALUES ($1, $2, 'ADMIN')`,
                [newCase.id, params.userId]
            );

            await client.query('COMMIT');
            return newCase;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    static async findById(caseId: string): Promise<CaseDetailsRow | null> {
        const result = await pool.query<CaseDetailsRow>(
            `SELECT id, organisation_id, title, description, status, case_number, court, case_type, instructions,
                    collection_id, filing_date, next_hearing_date, created_at, updated_at
             FROM cases WHERE id = $1`,
            [caseId]
        );
        return result.rows[0] || null;
    }

    static async update(caseId: string, updates: UpdateCaseParams): Promise<CaseUpdateResultRow | null> {
        const fields: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (updates.title != null) {
            fields.push(`title = $${idx++}`);
            values.push(updates.title);
        }
        if (updates.description != null) {
            fields.push(`description = $${idx++}`);
            values.push(updates.description);
        }
        if (updates.status != null) {
            fields.push(`status = $${idx++}`);
            values.push(updates.status);
        }
        if (updates.court != null) {
            fields.push(`court = $${idx++}`);
            values.push(updates.court);
        }
        if (updates.case_number != null) {
            fields.push(`case_number = $${idx++}`);
            values.push(updates.case_number);
        }
        if (updates.case_type != null) {
            fields.push(`case_type = $${idx++}`);
            values.push(updates.case_type);
        }
        if (updates.instructions != null) {
            fields.push(`instructions = $${idx++}`);
            values.push(updates.instructions);
        }
        if (updates.next_hearing_date != null) {
            fields.push(`next_hearing_date = $${idx++}`);
            values.push(updates.next_hearing_date);
        }

        if (fields.length === 0) {
            return null;
        }

        fields.push(`updated_at = NOW()`);
        values.push(caseId);

        const result = await pool.query<CaseUpdateResultRow>(
            `UPDATE cases SET ${fields.join(', ')} WHERE id = $${idx}
             RETURNING id, title, description, status, case_number, court, instructions, next_hearing_date, updated_at`,
            values
        );

        return result.rows[0] || null;
    }

    static async delete(caseId: string): Promise<boolean> {
        const result = await pool.query('DELETE FROM cases WHERE id = $1', [caseId]);
        return (result.rowCount ?? 0) > 0;
    }
}
