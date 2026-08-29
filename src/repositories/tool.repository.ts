import { Pool } from "pg";

export interface ToolRecord {
  id: string;
  case_id: string;
  script_id: string;
  webhook_url: string;
  title: string;
  description: string;
  openai_tool_json: any;
  created_at: Date;
  updated_at: Date;
}

export class ToolRepository {
  constructor(private pool: Pool) {}

  async create(data: {
    case_id: string;
    script_id: string;
    webhook_url: string;
    title: string;
    description: string;
    openai_tool_json: any;
  }): Promise<ToolRecord> {
    const query = `
      INSERT INTO tools (case_id, script_id, webhook_url, title, description, openai_tool_json)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;
    const values = [
      data.case_id,
      data.script_id,
      data.webhook_url,
      data.title,
      data.description,
      data.openai_tool_json,
    ];
    
    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  async update(script_id: string, data: {
    webhook_url?: string;
    title?: string;
    description?: string;
    openai_tool_json?: any;
  }): Promise<ToolRecord | null> {
    const fields = [];
    const values = [];
    let counter = 1;

    if (data.webhook_url !== undefined) {
      fields.push(`webhook_url = $${counter++}`);
      values.push(data.webhook_url);
    }
    if (data.title !== undefined) {
      fields.push(`title = $${counter++}`);
      values.push(data.title);
    }
    if (data.description !== undefined) {
      fields.push(`description = $${counter++}`);
      values.push(data.description);
    }
    if (data.openai_tool_json !== undefined) {
      fields.push(`openai_tool_json = $${counter++}`);
      values.push(data.openai_tool_json);
    }

    if (fields.length === 0) {
      const result = await this.pool.query('SELECT * FROM tools WHERE script_id = $1', [script_id]);
      return result.rows[0] || null;
    }

    fields.push(`updated_at = NOW()`);
    
    const query = `
      UPDATE tools 
      SET ${fields.join(', ')}
      WHERE script_id = $${counter}
      RETURNING *;
    `;
    values.push(script_id);

    const result = await this.pool.query(query, values);
    return result.rows[0] || null;
  }

  async delete(script_id: string): Promise<boolean> {
    const query = 'DELETE FROM tools WHERE script_id = $1 RETURNING id;';
    const result = await this.pool.query(query, [script_id]);
    return (result.rowCount ?? 0) > 0;
  }

  async findByCaseId(case_id: string): Promise<ToolRecord[]> {
    const query = 'SELECT * FROM tools WHERE case_id = $1 ORDER BY created_at DESC;';
    const result = await this.pool.query(query, [case_id]);
    return result.rows;
  }

  /**
   * Returns all tools the user has access to within the org,
   * annotated with case_title and case_id — for the cross-case import picker.
   * Excludes tools already present in the target case.
   */
  async findByOrgAndUser(orgId: string, userId: string, excludeCaseId: string): Promise<(ToolRecord & { case_title: string })[]> {
    const query = `
      SELECT t.*, c.title as case_title
      FROM tools t
      JOIN cases c ON t.case_id = c.id
      JOIN organisation_members om ON c.organisation_id = om.organisation_id AND om.user_id = $2
      LEFT JOIN case_members cm ON cm.case_id = c.id AND cm.user_id = $2
      WHERE c.organisation_id = $1
        AND t.case_id != $3
        AND (om.role = 'ADMIN' OR cm.user_id IS NOT NULL)
        AND t.script_id NOT IN (
          SELECT script_id FROM tools WHERE case_id = $3
        )
      ORDER BY c.title, t.title;
    `;
    const result = await this.pool.query(query, [orgId, userId, excludeCaseId]);
    return result.rows;
  }
}
