import pool from '../lib/db.js';
import type { Role } from '../types/index.js';

export interface CaseMemberDetails {
    user_id: string;
    name: string;
    email: string;
    avatar: string | null;
    role: Role;
    joined_at: string;
}

export class CaseMemberRepository {
    static async listMembers(caseId: string): Promise<CaseMemberDetails[]> {
        const result = await pool.query<CaseMemberDetails>(
            `SELECT u.id AS user_id, u.name, u.email, u.avatar, cm.role, cm.joined_at
             FROM case_members cm
             JOIN users u ON u.id = cm.user_id
             WHERE cm.case_id = $1
             ORDER BY cm.joined_at ASC`,
            [caseId]
        );
        return result.rows;
    }

    static async addMember(caseId: string, userId: string, role: Role): Promise<void> {
        await pool.query(
            `INSERT INTO case_members (case_id, user_id, role)
             VALUES ($1, $2, $3)
             ON CONFLICT (case_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
            [caseId, userId, role]
        );
    }

    static async updateRole(caseId: string, userId: string, role: Role): Promise<boolean> {
        const result = await pool.query(
            `UPDATE case_members SET role = $1 WHERE case_id = $2 AND user_id = $3`,
            [role, caseId, userId]
        );
        return (result.rowCount ?? 0) > 0;
    }

    static async removeMember(caseId: string, userId: string): Promise<boolean> {
        const result = await pool.query(
            `DELETE FROM case_members WHERE case_id = $1 AND user_id = $2`,
            [caseId, userId]
        );
        return (result.rowCount ?? 0) > 0;
    }

    static async getRole(caseId: string, userId: string): Promise<Role | null> {
        const result = await pool.query<{ role: Role }>(
            `SELECT role FROM case_members
             WHERE case_id = $1 AND user_id = $2`,
            [caseId, userId]
        );
        return result.rows[0]?.role || null;
    }
}
