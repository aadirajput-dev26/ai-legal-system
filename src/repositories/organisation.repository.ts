import pool from '../lib/db.js';

export interface OrganisationRow {
    id: string;
    name: string;
    description: string | null;
    created_at: string;
}

export interface OrganisationWithRoleRow extends OrganisationRow {
    role: string;
}

export interface OrganisationDetailsRow extends OrganisationRow {
    updated_at: string;
}

export class OrganisationRepository {
    static async listByUser(userId: string): Promise<OrganisationWithRoleRow[]> {
        const result = await pool.query<OrganisationWithRoleRow>(
            `SELECT o.id, o.name, o.description, o.created_at, om.role
             FROM organisations o
             JOIN organisation_members om ON om.organisation_id = o.id
             WHERE om.user_id = $1
             ORDER BY o.created_at DESC`,
            [userId]
        );
        return result.rows;
    }

    static async create(name: string, description: string | null, userId: string): Promise<OrganisationRow> {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const orgResult = await client.query<OrganisationRow>(
                `INSERT INTO organisations (name, description)
                 VALUES ($1, $2)
                 RETURNING id, name, description, created_at`,
                [name, description ?? null]
            );
            const org = orgResult.rows[0];

            await client.query(
                `INSERT INTO organisation_members (organisation_id, user_id, role)
                 VALUES ($1, $2, 'ADMIN')`,
                [org.id, userId]
            );

            await client.query('COMMIT');
            return org;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    static async findById(id: string): Promise<OrganisationDetailsRow | null> {
        const result = await pool.query<OrganisationDetailsRow>(
            'SELECT id, name, description, created_at, updated_at FROM organisations WHERE id = $1',
            [id]
        );
        return result.rows[0] || null;
    }

    static async update(
        id: string,
        updates: { name?: string; description?: string }
    ): Promise<OrganisationDetailsRow | null> {
        const fields: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (updates.name != null) {
            fields.push(`name = $${idx++}`);
            values.push(updates.name);
        }
        if (updates.description != null) {
            fields.push(`description = $${idx++}`);
            values.push(updates.description);
        }

        if (fields.length === 0) {
            return null;
        }

        fields.push(`updated_at = NOW()`);
        values.push(id);

        const result = await pool.query<OrganisationDetailsRow>(
            `UPDATE organisations SET ${fields.join(', ')} WHERE id = $${idx} 
             RETURNING id, name, description, created_at, updated_at`,
            values
        );

        return result.rows[0] || null;
    }

    static async delete(id: string): Promise<boolean> {
        const result = await pool.query('DELETE FROM organisations WHERE id = $1', [id]);
        return (result.rowCount ?? 0) > 0;
    }
}
