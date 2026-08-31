import pool from '../lib/db.js';

export interface NotificationRow {
    id: string;
    user_id: string;
    organisation_id: string;
    case_id?: string | null;
    title: string;
    message: string;
    type: 'HEARING_ALERT' | 'TASK_DUE' | 'CASE_UPDATE' | 'AI_INSIGHT' | 'SYSTEM' | string;
    priority: 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW' | string;
    link?: string | null;
    is_read: boolean;
    read_at?: string | null;
    created_at: string;
    case_title?: string | null;
    case_number?: string | null;
    court?: string | null;
}

export class NotificationRepository {
    static async listByUser(
        userId: string, 
        orgId: string,
        filters?: { isRead?: boolean; type?: string; priority?: string; limit?: number }
    ): Promise<{ notifications: NotificationRow[]; unreadCount: number }> {
        const values: any[] = [userId, orgId];
        let query = `
            SELECT n.*, c.title as case_title, c.case_number, c.court
            FROM notifications n
            LEFT JOIN cases c ON n.case_id = c.id
            WHERE n.user_id = $1 AND n.organisation_id = $2
        `;

        if (filters?.isRead !== undefined) {
            values.push(filters.isRead);
            query += ` AND n.is_read = $${values.length}`;
        }

        if (filters?.type && filters.type !== 'ALL') {
            values.push(filters.type);
            query += ` AND n.type = $${values.length}`;
        }

        if (filters?.priority && filters.priority !== 'ALL') {
            values.push(filters.priority);
            query += ` AND n.priority = $${values.length}`;
        }

        query += ` ORDER BY n.created_at DESC`;

        if (filters?.limit) {
            values.push(filters.limit);
            query += ` LIMIT $${values.length}`;
        }

        const [listRes, countRes] = await Promise.all([
            pool.query<NotificationRow>(query, values),
            pool.query<{ count: string }>(
                `SELECT COUNT(*) as count FROM notifications 
                 WHERE user_id = $1 AND organisation_id = $2 AND is_read = FALSE`,
                [userId, orgId]
            )
        ]);

        return {
            notifications: listRes.rows,
            unreadCount: parseInt(countRes.rows[0]?.count || '0', 10)
        };
    }

    static async create(data: {
        userId: string;
        organisationId: string;
        caseId?: string | null;
        title: string;
        message: string;
        type?: string;
        priority?: string;
        link?: string | null;
    }): Promise<NotificationRow> {
        const res = await pool.query<NotificationRow>(
            `INSERT INTO notifications (user_id, organisation_id, case_id, title, message, type, priority, link)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [
                data.userId,
                data.organisationId,
                data.caseId || null,
                data.title,
                data.message,
                data.type || 'SYSTEM',
                data.priority || 'NORMAL',
                data.link || null
            ]
        );
        return res.rows[0];
    }

    static async markAsRead(id: string, userId: string): Promise<NotificationRow | null> {
        const res = await pool.query<NotificationRow>(
            `UPDATE notifications 
             SET is_read = TRUE, read_at = NOW()
             WHERE id = $1 AND user_id = $2
             RETURNING *`,
            [id, userId]
        );
        return res.rows[0] || null;
    }

    static async markAsUnread(id: string, userId: string): Promise<NotificationRow | null> {
        const res = await pool.query<NotificationRow>(
            `UPDATE notifications 
             SET is_read = FALSE, read_at = NULL
             WHERE id = $1 AND user_id = $2
             RETURNING *`,
            [id, userId]
        );
        return res.rows[0] || null;
    }

    static async markAllAsRead(userId: string, orgId: string): Promise<number> {
        const res = await pool.query(
            `UPDATE notifications 
             SET is_read = TRUE, read_at = NOW()
             WHERE user_id = $1 AND organisation_id = $2 AND is_read = FALSE`,
            [userId, orgId]
        );
        return res.rowCount ?? 0;
    }

    static async delete(id: string, userId: string): Promise<boolean> {
        const res = await pool.query(
            `DELETE FROM notifications WHERE id = $1 AND user_id = $2`,
            [id, userId]
        );
        return (res.rowCount ?? 0) > 0;
    }

    /**
     * Smart Alert Generator:
     * Scans upcoming hearings, overdue tasks, and case events for the user's organisation
     * and generates alerts if not already existing.
     */
    static async syncSmartAlerts(userId: string, orgId: string): Promise<void> {
        // 1. Check for upcoming hearings within next 72 hours
        const upcomingHearings = await pool.query(
            `SELECT h.id, h.case_id, h.date, h.notes, c.title as case_title, c.court, c.stage, c.judge
             FROM hearings h
             JOIN cases c ON h.case_id = c.id
             JOIN organisation_members om ON c.organisation_id = om.organisation_id AND om.user_id = $2
             WHERE c.organisation_id = $1 
               AND h.date >= NOW() - INTERVAL '1 hour'
               AND h.date <= NOW() + INTERVAL '72 hours'`,
            [orgId, userId]
        );

        for (const h of upcomingHearings.rows) {
            const hearingDate = new Date(h.date);
            const hoursUntil = Math.round((hearingDate.getTime() - Date.now()) / (1000 * 60 * 60));
            const priority = hoursUntil <= 24 ? 'URGENT' : 'HIGH';
            const timeStr = hoursUntil <= 24 ? `in ${hoursUntil} hours` : `on ${hearingDate.toLocaleDateString()}`;

            // Check if alert already exists for this hearing
            const existing = await pool.query(
                `SELECT id FROM notifications 
                 WHERE user_id = $1 AND case_id = $2 AND type = 'HEARING_ALERT' AND message LIKE $3`,
                [userId, h.case_id, `%${h.court || ''}%`]
            );

            if (existing.rows.length === 0) {
                await this.create({
                    userId,
                    organisationId: orgId,
                    caseId: h.case_id,
                    title: `Upcoming Court Hearing: ${h.case_title}`,
                    message: `Matter is listed before ${h.judge || 'Bench'} at ${h.court || 'Court'} ${timeStr}. Stage: ${h.stage || 'Arguments'}.`,
                    type: 'HEARING_ALERT',
                    priority,
                    link: `/cases/${h.case_id}`
                });
            }
        }

        // 2. Check for overdue or due-today tasks
        const dueTasks = await pool.query(
            `SELECT t.id, t.case_id, t.title, t.due_date, t.status, c.title as case_title
             FROM tasks t
             JOIN cases c ON t.case_id = c.id
             JOIN organisation_members om ON c.organisation_id = om.organisation_id AND om.user_id = $2
             WHERE c.organisation_id = $1 
               AND t.status != 'COMPLETED'
               AND t.due_date IS NOT NULL
               AND t.due_date <= NOW() + INTERVAL '24 hours'`,
            [orgId, userId]
        );

        for (const t of dueTasks.rows) {
            const dueDate = new Date(t.due_date);
            const isOverdue = dueDate.getTime() < Date.now();
            const priority = isOverdue ? 'URGENT' : 'HIGH';

            const existing = await pool.query(
                `SELECT id FROM notifications 
                 WHERE user_id = $1 AND case_id = $2 AND type = 'TASK_DUE' AND title LIKE $3`,
                [userId, t.case_id, `%${t.title}%`]
            );

            if (existing.rows.length === 0) {
                await this.create({
                    userId,
                    organisationId: orgId,
                    caseId: t.case_id,
                    title: `${isOverdue ? 'Overdue Action Item' : 'Task Due Today'}: ${t.title}`,
                    message: `Action item for ${t.case_title} requires attention. Due date: ${dueDate.toLocaleDateString()}.`,
                    type: 'TASK_DUE',
                    priority,
                    link: `/cases/${t.case_id}`
                });
            }
        }
    }
}
