import pool from '../lib/db.js';
import type { Role } from '../types/index.js';

export interface OrgMemberDetails {
    user_id: string;
    name: string;
    email: string;
    avatar: string | null;
    role: Role;
    joined_at: string;
}

export class OrgMemberRepository {
    static async listMembers(orgId: string): Promise<OrgMemberDetails[]> {
        const result = await pool.query<OrgMemberDetails>(
            `SELECT u.id AS user_id, u.name, u.email, u.avatar, om.role, om.joined_at
             FROM organisation_members om
             JOIN users u ON u.id = om.user_id
             WHERE om.organisation_id = $1
             ORDER BY om.joined_at ASC`,
            [orgId]
        );
        return result.rows;
    }

    static async addMember(orgId: string, userId: string, role: Role): Promise<void> {
        await pool.query(
            `INSERT INTO organisation_members (organisation_id, user_id, role)
             VALUES ($1, $2, $3)
             ON CONFLICT (organisation_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
            [orgId, userId, role]
        );
    }

    static async updateRole(orgId: string, userId: string, role: Role): Promise<boolean> {
        const result = await pool.query(
            `UPDATE organisation_members SET role = $1
             WHERE organisation_id = $2 AND user_id = $3`,
            [role, orgId, userId]
        );
        return (result.rowCount ?? 0) > 0;
    }

    static async removeMember(orgId: string, userId: string): Promise<boolean> {
        const result = await pool.query(
            `DELETE FROM organisation_members
             WHERE organisation_id = $1 AND user_id = $2`,
            [orgId, userId]
        );
        return (result.rowCount ?? 0) > 0;
    }

    static async getRole(orgId: string, userId: string): Promise<Role | null> {
        const result = await pool.query<{ role: Role }>(
            `SELECT role FROM organisation_members
             WHERE organisation_id = $1 AND user_id = $2`,
            [orgId, userId]
        );
        return result.rows[0]?.role || null;
    }
}
