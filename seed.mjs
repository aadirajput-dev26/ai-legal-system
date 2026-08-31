import pg from 'pg';
import { config as dotenv } from 'dotenv';
dotenv();

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password123@localhost:5432/ai_legal_db' });

async function seed() {
    await client.connect();
    console.log('Connected to DB for seeding...');

    // 1. Create a dummy org
    const orgRes = await client.query(`
        INSERT INTO organisations (name) VALUES ('Test Org') RETURNING id
    `);
    const orgId = orgRes.rows[0].id;

    // 2. Create a dummy user
    const userRes = await client.query(`
        INSERT INTO users (name, email, password_hash) VALUES ('Aaditya', 'test@test.com', 'dummyhash') RETURNING id
    `);
    const userId = userRes.rows[0].id;

    await client.query(`INSERT INTO organisation_members (organisation_id, user_id, role) VALUES ($1, $2, 'ADMIN')`, [orgId, userId]);

    // 3. Insert mock cases
    const cases = [
        { title: 'Patel v. State of Gujarat', case_number: 'CRL.A/1247/2024', court: 'Gujarat HC', stage: 'Arguments', client_name: 'R. Patel', opposing_party: 'State of Gujarat', judge: "Hon'ble Justice A. Rao", next_hearing_date: '2026-03-12 10:30:00Z', filing_date: '2024-08-14' },
        { title: 'Sharma Properties v. Municipal Corporation', case_number: 'CS/882/2023', court: 'City Civil', stage: 'Issues', client_name: 'Sharma Properties Pvt Ltd', opposing_party: 'Municipal Corporation', judge: 'Justice B. Kumar', next_hearing_date: '2026-03-12 14:00:00Z', filing_date: '2023-11-01' },
        { title: 'Verma v. Verma', case_number: 'HMP/448/2025', court: 'Family Court', stage: 'Evidence', client_name: 'N. Verma', opposing_party: 'S. Verma', judge: 'Justice C. Shah', next_hearing_date: '2026-03-13 11:00:00Z', filing_date: '2025-01-10' }
    ];

    for (const c of cases) {
        const caseRes = await client.query(`
            INSERT INTO cases (organisation_id, title, case_number, court, stage, client_name, opposing_party, judge, next_hearing_date, filing_date)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id
        `, [orgId, c.title, c.case_number, c.court, c.stage, c.client_name, c.opposing_party, c.judge, c.next_hearing_date, c.filing_date]);
        
        const caseId = caseRes.rows[0].id;
        await client.query(`INSERT INTO case_members (case_id, user_id, role) VALUES ($1, $2, 'ADMIN')`, [caseId, userId]);

        // Insert some tasks
        await client.query(`INSERT INTO tasks (case_id, title, status, due_date, assigned_to) VALUES ($1, $2, $3, $4, $5)`, [caseId, 'Review final arguments', 'PENDING', '2026-03-10 12:00:00Z', userId]);
    }

    console.log('Seeding complete!');
    await client.end();
}

seed().catch(err => {
    console.error(err);
    process.exit(1);
});
