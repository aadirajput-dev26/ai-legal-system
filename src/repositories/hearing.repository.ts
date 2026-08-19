import pool from '../lib/db.js';

export interface HearingRow {
    id: string;
    case_id: string;
    date: Date;
    notes: string;
    status: string;
    notified_immediately: boolean;
    notified_24h: boolean;
    notified_1h: boolean;
    created_at: Date;
    updated_at: Date;
}

export class HearingRepository {
    // ── Create ──────────────────────────────────────────────────────
    static async create(caseId: string, date: Date, notes: string = ''): Promise<HearingRow> {
        const result = await pool.query<HearingRow>(
            `INSERT INTO hearings (case_id, date, notes)
             VALUES ($1, $2, $3) RETURNING *`,
            [caseId, date, notes]
        );
        return result.rows[0];
    }

    // ── List ─────────────────────────────────────────────────────────
    static async listByCaseId(caseId: string): Promise<HearingRow[]> {
        const result = await pool.query<HearingRow>(
            `SELECT * FROM hearings WHERE case_id = $1 ORDER BY date ASC`,
            [caseId]
        );
        return result.rows;
    }

    // ── Notification Queries ─────────────────────────────────────────

    /** Hearings that were JUST created and haven't sent the immediate notification yet. */
    static async getHearingsForImmediateNotification(): Promise<HearingRow[]> {
        const result = await pool.query<HearingRow>(
            `SELECT * FROM hearings
             WHERE status = 'SCHEDULED'
               AND notified_immediately = FALSE
               AND date > NOW()
             ORDER BY date ASC`
        );
        return result.rows;
    }

    /** Hearings whose date is between now+23h and now+25h that haven't sent the 24h reminder yet. */
    static async getHearingsDue24hNotification(): Promise<HearingRow[]> {
        const result = await pool.query<HearingRow>(
            `SELECT * FROM hearings
             WHERE status = 'SCHEDULED'
               AND notified_24h = FALSE
               AND date BETWEEN NOW() + INTERVAL '23 hours'
                             AND NOW() + INTERVAL '25 hours'
             ORDER BY date ASC`
        );
        return result.rows;
    }

    /** Hearings whose date is between now+45min and now+75min that haven't sent the 1h reminder yet. */
    static async getHearingsDue1hNotification(): Promise<HearingRow[]> {
        const result = await pool.query<HearingRow>(
            `SELECT * FROM hearings
             WHERE status = 'SCHEDULED'
               AND notified_1h = FALSE
               AND date BETWEEN NOW() + INTERVAL '45 minutes'
                             AND NOW() + INTERVAL '75 minutes'
             ORDER BY date ASC`
        );
        return result.rows;
    }

    // ── Mark Helpers ─────────────────────────────────────────────────

    static async markNotified(
        hearingId: string,
        stage: 'immediately' | '24h' | '1h'
    ): Promise<void> {
        const col =
            stage === 'immediately' ? 'notified_immediately' :
            stage === '24h'        ? 'notified_24h'         :
                                     'notified_1h';
        await pool.query(
            `UPDATE hearings SET ${col} = TRUE, updated_at = NOW() WHERE id = $1`,
            [hearingId]
        );
    }

    /** Called once all 3 stages have fired – marks the hearing as fully notified. */
    static async markCompleted(hearingId: string): Promise<void> {
        await pool.query(
            `UPDATE hearings SET status = 'COMPLETED', updated_at = NOW() WHERE id = $1`,
            [hearingId]
        );
    }
}
