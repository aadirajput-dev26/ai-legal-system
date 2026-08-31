import pool from '../lib/db.js';

export interface CaseRow {
    id: string;
    title: string;
    status: string;
    collection_id: string;
}

export interface CaseWithRoleRow {
    id: string;
    organisation_id: string;
    collection_id: string | null;
    title: string;
    description: string | null;
    status: string;
    case_number: string | null;
    court: string | null;
    case_type: string | null;
    stage: string | null;
    judge: string | null;
    client_name: string | null;
    opposing_party: string | null;
    filing_date: string | null;
    next_hearing_date: string | null;
    created_at: string;
    updated_at: string;
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
    stage: string | null;
    judge: string | null;
    client_name: string | null;
    opposing_party: string | null;
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
    stage?: string;
    judge?: string;
    client_name?: string;
    opposing_party?: string;
}

export interface CaseUpdateResultRow {
    id: string;
    title: string;
    status: string;
    case_number: string | null;
    court: string | null;
    instructions: string | null;
    next_hearing_date: string | null;
    stage: string | null;
    judge: string | null;
    client_name: string | null;
    opposing_party: string | null;
    updated_at: string;
}

export class CaseRepository {
    static async listByUserAndOrg(orgId: string, userId: string): Promise<CaseWithRoleRow[]> {
        const result = await pool.query<CaseWithRoleRow>(
            `SELECT c.id, c.organisation_id, c.collection_id, c.title, c.description, c.status, c.case_number, c.court, c.case_type,
                    c.stage, c.judge, c.client_name, c.opposing_party, c.filing_date,
                    c.next_hearing_date, c.created_at, c.updated_at, COALESCE(cm.role, 'ADMIN') as role
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
        stage?: string | null;
        judge?: string | null;
        clientName?: string | null;
        opposingParty?: string | null;
        userId: string;
    }): Promise<CaseRow> {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const caseResult = await client.query<CaseRow>(
                `INSERT INTO cases
                    (organisation_id, collection_id, title, description, case_number, court, case_type, instructions, filing_date, stage, judge, client_name, opposing_party)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
                    params.stage ?? null,
                    params.judge ?? null,
                    params.clientName ?? null,
                    params.opposingParty ?? null,
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
                    collection_id, filing_date, next_hearing_date, stage, judge, client_name, opposing_party, created_at, updated_at
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
        if (updates.stage != null) {
            fields.push(`stage = $${idx++}`);
            values.push(updates.stage);
        }
        if (updates.judge != null) {
            fields.push(`judge = $${idx++}`);
            values.push(updates.judge);
        }
        if (updates.client_name != null) {
            fields.push(`client_name = $${idx++}`);
            values.push(updates.client_name);
        }
        if (updates.opposing_party != null) {
            fields.push(`opposing_party = $${idx++}`);
            values.push(updates.opposing_party);
        }

        if (fields.length === 0) {
            return null;
        }

        fields.push(`updated_at = NOW()`);
        values.push(caseId);

        const result = await pool.query<CaseUpdateResultRow>(
            `UPDATE cases SET ${fields.join(', ')} WHERE id = $${idx}
             RETURNING id, title, description, status, case_number, court, instructions, next_hearing_date, stage, judge, client_name, opposing_party, updated_at`,
            values
        );

        return result.rows[0] || null;
    }

    static async delete(caseId: string): Promise<boolean> {
        const result = await pool.query('DELETE FROM cases WHERE id = $1', [caseId]);
        return (result.rowCount ?? 0) > 0;
    }

    static async getCalendar(orgId: string, userId: string): Promise<{
        hearings: any[];
        tasks: any[];
        cases: any[];
    }> {
        const hearingsRes = await pool.query(
            `SELECT h.id, h.case_id, h.date, h.notes, h.status,
                    c.title as case_title, c.case_number, c.court, c.stage, c.judge, c.client_name, c.opposing_party
             FROM hearings h
             JOIN cases c ON h.case_id = c.id
             JOIN organisation_members om ON c.organisation_id = om.organisation_id AND om.user_id = $2
             LEFT JOIN case_members cm ON cm.case_id = c.id AND cm.user_id = $2
             WHERE c.organisation_id = $1 
               AND (om.role = 'ADMIN' OR cm.user_id IS NOT NULL)
             ORDER BY h.date ASC`,
            [orgId, userId]
        );

        const tasksRes = await pool.query(
            `SELECT t.id, t.case_id, t.title, t.description, t.status, t.due_date, t.assigned_to,
                    c.title as case_title, c.case_number, c.court, c.stage
             FROM tasks t
             JOIN cases c ON t.case_id = c.id
             JOIN organisation_members om ON c.organisation_id = om.organisation_id AND om.user_id = $2
             LEFT JOIN case_members cm ON cm.case_id = c.id AND cm.user_id = $2
             WHERE c.organisation_id = $1 
               AND (om.role = 'ADMIN' OR cm.user_id IS NOT NULL)
             ORDER BY t.due_date ASC NULLS LAST`,
            [orgId, userId]
        );

        const casesRes = await pool.query(
            `SELECT c.id, c.title, c.case_number, c.court, c.stage, c.judge, c.client_name,
                    c.opposing_party, c.filing_date, c.next_hearing_date, c.status
             FROM cases c
             JOIN organisation_members om ON c.organisation_id = om.organisation_id AND om.user_id = $2
             LEFT JOIN case_members cm ON cm.case_id = c.id AND cm.user_id = $2
             WHERE c.organisation_id = $1 
               AND (om.role = 'ADMIN' OR cm.user_id IS NOT NULL)`,
            [orgId, userId]
        );

        return {
            hearings: hearingsRes.rows,
            tasks: tasksRes.rows,
            cases: casesRes.rows
        };
    }
}
