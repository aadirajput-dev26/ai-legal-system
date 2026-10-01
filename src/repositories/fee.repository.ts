import pool from '../lib/db.js';

export class FeeRepository {
    static async getFeesSummary(caseId: string) {
        const result = await pool.query(
            `SELECT total_agreed_fee, total_received, outstanding_balance
             FROM case_fee_schedules WHERE case_id = $1`,
            [caseId]
        );
        return result.rows[0] || { total_agreed_fee: 0, total_received: 0, outstanding_balance: 0 };
    }

    static async updateFeeSchedule(caseId: string, totalAgreedFee: number) {
        const check = await pool.query('SELECT id FROM case_fee_schedules WHERE case_id = $1', [caseId]);
        
        if (check.rows.length > 0) {
            const result = await pool.query(
                `UPDATE case_fee_schedules SET total_agreed_fee = $2, updated_at = NOW() WHERE case_id = $1 RETURNING *`,
                [caseId, totalAgreedFee]
            );
            return result.rows[0];
        } else {
            const result = await pool.query(
                `INSERT INTO case_fee_schedules (case_id, total_agreed_fee) VALUES ($1, $2) RETURNING *`,
                [caseId, totalAgreedFee]
            );
            return result.rows[0];
        }
    }

    static async getMilestones(caseId: string) {
        const result = await pool.query(
            `SELECT * FROM case_fee_milestones WHERE case_id = $1 ORDER BY created_at ASC`,
            [caseId]
        );
        return result.rows;
    }

    static async getPayments(caseId: string) {
        const result = await pool.query(
            `SELECT * FROM case_fee_payments WHERE case_id = $1 ORDER BY payment_date DESC`,
            [caseId]
        );
        return result.rows;
    }

    static async createMilestone(caseId: string, stageName: string, amount: number, dueDate?: string) {
        const result = await pool.query(
            `INSERT INTO case_fee_milestones (case_id, stage_name, amount, due_date) VALUES ($1, $2, $3, $4) RETURNING *`,
            [caseId, stageName, amount, dueDate || null]
        );
        return result.rows[0];
    }

    static async recordPayment(caseId: string, milestoneId: string | null, amount: number, paymentMode: string, receiptNumber: string | null, notes: string | null) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const paymentResult = await client.query(
                `INSERT INTO case_fee_payments (case_id, milestone_id, amount_paid, payment_mode, receipt_number, notes) 
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
                [caseId, milestoneId || null, amount, paymentMode, receiptNumber || null, notes || null]
            );

            if (milestoneId) {
                await client.query(`UPDATE case_fee_milestones SET status = 'PAID' WHERE id = $1`, [milestoneId]);
            }

            // Update total received
            await client.query(
                `UPDATE case_fee_schedules SET total_received = total_received + $2, updated_at = NOW() WHERE case_id = $1`,
                [caseId, amount]
            );

            await client.query('COMMIT');
            return paymentResult.rows[0];
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }
}
