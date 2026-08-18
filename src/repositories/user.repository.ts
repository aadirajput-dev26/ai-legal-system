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

    static async create(name: string, email: string, passwordHash: string): Promise<UserRow> {
        const result = await pool.query<UserRow>(
            `INSERT INTO users (name, email, password_hash)
             VALUES ($1, $2, $3)
             RETURNING id, name, email`,
            [name, email.toLowerCase(), passwordHash]
        );
        return result.rows[0];
    }
}
