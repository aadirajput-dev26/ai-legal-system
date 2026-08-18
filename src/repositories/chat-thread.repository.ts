import pool from '../lib/db.js';

export class ChatThreadRepository {
    static async create(caseId: string, title: string) {
        const result = await pool.query(
            `INSERT INTO chat_threads (case_id, title)
             VALUES ($1, $2) RETURNING *`,
            [caseId, title]
        );
        return result.rows[0];
    }

    static async listByCaseId(caseId: string) {
        const result = await pool.query(
            `SELECT * FROM chat_threads WHERE case_id = $1 ORDER BY created_at DESC`,
            [caseId]
        );
        return result.rows;
    }

    static async getById(threadId: string) {
        const result = await pool.query(
            `SELECT * FROM chat_threads WHERE id = $1`,
            [threadId]
        );
        return result.rows[0];
    }
}
