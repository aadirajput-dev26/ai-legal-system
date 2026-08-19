import pool from '../lib/db.js';

export class HearingRepository {
    static async create(caseId: string, date: Date, notes: string = '') {
        const result = await pool.query(
            `INSERT INTO hearings (case_id, date, notes)
             VALUES ($1, $2, $3) RETURNING *`,
            [caseId, date, notes]
        );
        return result.rows[0];
    }

    static async listByCaseId(caseId: string) {
        const result = await pool.query(
            `SELECT * FROM hearings WHERE case_id = $1 ORDER BY date ASC`,
            [caseId]
        );
        return result.rows;
    }
}
