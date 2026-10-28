import pool from '../lib/db.js';

export interface UserRow {
    id: string;
    name: string;
    email: string;
}

export interface UserWithPasswordRow extends UserRow {
    password_hash: string;
}

export class UserRepository {
    static async findByEmail(email: string): Promise<UserWithPasswordRow | null> {
        const result = await pool.query<UserWithPasswordRow>(
            'SELECT id, name, email, password_hash FROM users WHERE email = $1',
            [email.toLowerCase()]
        );
        return result.rows[0] || null;
    }

    static async existsByEmail(email: string): Promise<boolean> {
        const result = await pool.query(
            'SELECT id FROM users WHERE email = $1',
            [email.toLowerCase()]
        );
        return result.rows.length > 0;
    }

    static async create(name: string, email: string, passwordHash: string, avatar?: string | null): Promise<UserRow> {
        const result = await pool.query<UserRow>(
            `INSERT INTO users (name, email, password_hash, avatar)
             VALUES ($1, $2, $3, $4)
             RETURNING id, name, email`,
            [name, email.toLowerCase(), passwordHash, avatar || null]
        );
        return result.rows[0];
    }

    static async findById(id: string): Promise<UserRow | null> {
        const result = await pool.query<UserRow>(
            'SELECT id, name, email FROM users WHERE id = $1',
            [id]
        );
        return result.rows[0] || null;
    }

    static async updatePassword(id: string, passwordHash: string): Promise<void> {
        await pool.query(
            'UPDATE users SET password_hash = $1 WHERE id = $2',
            [passwordHash, id]
        );
    }
}
