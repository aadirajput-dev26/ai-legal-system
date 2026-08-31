import pool from '../lib/db.js';

export interface TaskRow {
    id: string;
    case_id: string;
    title: string;
    description: string | null;
    status: 'PENDING' | 'COMPLETED' | 'OVERDUE';
    due_date: string | null;
    assigned_to: string | null;
    created_at: string;
    updated_at: string;
}

export interface CreateTaskParams {
    caseId: string;
    title: string;
    description?: string;
    status?: 'PENDING' | 'COMPLETED' | 'OVERDUE';
    dueDate?: string;
    assignedTo?: string;
}

export interface UpdateTaskParams {
    title?: string;
    description?: string;
    status?: 'PENDING' | 'COMPLETED' | 'OVERDUE';
    dueDate?: string;
    assignedTo?: string;
}

export class TaskRepository {
    static async listByCase(caseId: string): Promise<TaskRow[]> {
        const result = await pool.query<TaskRow>(
            `SELECT id, case_id, title, description, status, due_date, assigned_to, created_at, updated_at
             FROM tasks
             WHERE case_id = $1
             ORDER BY due_date ASC NULLS LAST, created_at DESC`,
            [caseId]
        );
        return result.rows;
    }

    static async listByUser(userId: string): Promise<TaskRow[]> {
        const result = await pool.query<TaskRow>(
            `SELECT id, case_id, title, description, status, due_date, assigned_to, created_at, updated_at
             FROM tasks
             WHERE assigned_to = $1
             ORDER BY due_date ASC NULLS LAST, created_at DESC`,
            [userId]
        );
        return result.rows;
    }

    static async create(params: CreateTaskParams): Promise<TaskRow> {
        const result = await pool.query<TaskRow>(
            `INSERT INTO tasks (case_id, title, description, status, due_date, assigned_to)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, case_id, title, description, status, due_date, assigned_to, created_at, updated_at`,
            [
                params.caseId,
                params.title,
                params.description ?? null,
                params.status ?? 'PENDING',
                params.dueDate ?? null,
                params.assignedTo ?? null,
            ]
        );
        return result.rows[0];
    }

    static async update(taskId: string, updates: UpdateTaskParams): Promise<TaskRow | null> {
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
        if (updates.dueDate != null) {
            fields.push(`due_date = $${idx++}`);
            values.push(updates.dueDate);
        }
        if (updates.assignedTo !== undefined) { // can be null to unassign
            fields.push(`assigned_to = $${idx++}`);
            values.push(updates.assignedTo);
        }

        if (fields.length === 0) return null;

        fields.push(`updated_at = NOW()`);
        values.push(taskId);

        const result = await pool.query<TaskRow>(
            `UPDATE tasks SET ${fields.join(', ')} WHERE id = $${idx}
             RETURNING id, case_id, title, description, status, due_date, assigned_to, created_at, updated_at`,
            values
        );
        return result.rows[0] || null;
    }

    static async delete(taskId: string): Promise<boolean> {
        const result = await pool.query('DELETE FROM tasks WHERE id = $1', [taskId]);
        return (result.rowCount ?? 0) > 0;
    }
}
