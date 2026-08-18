# Database Design & Schema Specification - AI Legal Case Management System

> **Note on Schema Flexibility & Evolution**:
> The database structure documented below reflects the updated design integrating **Hippocampus RAG Service**. All case document resources, embeddings, files, and ingestion metadata are managed directly by Hippocampus under a dedicated `collection_id` for each case. Therefore, a separate PostgreSQL `documents` table is unnecessary. Because domain requirements and entity relationships may evolve as development progresses, this schema is intentionally designed to be **modular and extensible**. Using an ORM / Migration tool (such as **Prisma** or **Kysely**) allows easy schema modifications, column additions, index tweaking, and migration history tracking without breaking existing data.

---

## 1. Primary Database Choice
* **Primary DB**: **PostgreSQL**
* **Reasoning**: Legal case management involves complex relational hierarchies, strict multi-tenant scoping, transactional integrity, foreign key constraints, and audit trail requirements.

---

## 2. Table Schemas (Updated Architecture)

### 1. `organisations`
*Represents a law firm or advocate firm.*
- `id` (UUID / String, Primary Key)
- `name` (String, Required)
- `description` (Text, Optional)
- `created_at` (Timestamp, Default: `now()`)
- `updated_at` (Timestamp, Default: `now()`)

### 2. `users`
*Represents individual lawyers, advocates, and firm staff.*
- `id` (UUID / String, Primary Key)
- `name` (String, Required)
- `email` (String, Unique, Required)
- `avatar` (String, Optional)
- `created_at` (Timestamp, Default: `now()`)

### 3. `organisation_members`
*Junction table linking users to their respective law firms.*
- `organisation_id` (UUID, Foreign Key -> `organisations.id`)
- `user_id` (UUID, Foreign Key -> `users.id`)
- `role` (String - e.g., `'OWNER'`, `'ADMIN'`, `'LAWYER'`, `'PARALEGAL'`)
- *Primary Key*: (`organisation_id`, `user_id`)

### 4. `cases`
*Primary workspace container for legal matters.*
- `id` (UUID, Primary Key)
- `organisation_id` (UUID, Foreign Key -> `organisations.id`)
- `collection_id` (String, Optional/Unique - Hippocampus collection ID generated upon case creation)
- `title` (String, Required)
- `description` (Text, Optional)
- `case_number` (String, Optional / Indexable)
- `court` (String, Optional - e.g., High Court, District Court)
- `case_type` (String, Optional - e.g., Civil, Criminal, Corporate)
- `status` (Enum/String - Default: `'OPEN'`. MVP values: `OPEN`, `CLOSED`, `ARCHIVED`. Extensible to `ON_HOLD`, `DISPOSED`)
- `filing_date` (Date, Optional)
- `next_hearing_date` (Date / Timestamp, Optional)

### 5. `case_members`
*Junction table defining which firm lawyers/staff have access to a specific case.*
- `case_id` (UUID, Foreign Key -> `cases.id`)
- `user_id` (UUID, Foreign Key -> `users.id`)
- `role` (String - e.g., `'LEAD_COUNSEL'`, `'ASSOCIATE'`, `'VIEWER'`)
- `joined_at` (Timestamp, Default: `now()`)
- *Primary Key*: (`case_id`, `user_id`)

### 6. `hearings`
*Tracks court hearings scheduled for a case.*
- `id` (UUID, Primary Key)
- `case_id` (UUID, Foreign Key -> `cases.id`)
- `hearing_date` (Date / Timestamp, Required)
- `hearing_type` (String - e.g., `'ARGUMENTS'`, `'EVIDENCE'`, `'FINAL_HEARING'`)
- `status` (String - e.g., `'SCHEDULED'`, `'COMPLETED'`, `'ADJOURNED'`)
- `summary` (Text, Optional)
- `next_hearing_date` (Date / Timestamp, Optional)

### 7. `orders`
*Tracks court orders passed during or after hearings.*
- `id` (UUID, Primary Key)
- `case_id` (UUID, Foreign Key -> `cases.id`)
- `hearing_id` (UUID, Foreign Key -> `hearings.id`, Optional)
- `title` (String, Required)
- `summary` (Text, Optional)
- `resource_id` (String, Optional - Corresponding Hippocampus resource ID for order document)
- `order_date` (Date, Required)

### 8. `tasks`
*Follow-ups and preparation tasks associated with a case.*
- `id` (UUID, Primary Key)
- `case_id` (UUID, Foreign Key -> `cases.id`)
- `title` (String, Required)
- `description` (Text, Optional)
- `assigned_to` (UUID, Foreign Key -> `users.id`, Optional)
- `due_date` (Timestamp, Optional)
- `status` (Enum/String - `PENDING`, `IN_PROGRESS`, `COMPLETED`)
- `priority` (Enum/String - `LOW`, `MEDIUM`, `HIGH`, `URGENT`)

### 9. `timeline_events`
*Chronological audit log of key case activities.*
- `id` (UUID, Primary Key)
- `case_id` (UUID, Foreign Key -> `cases.id`)
- `event_type` (String - e.g., `'HEARING_UPDATED'`, `'DOCUMENT_UPLOADED'`, `'ORDER_PASSED'`)
- `title` (String, Required)
- `description` (Text, Optional)
- `reference_type` (String, Optional - e.g., `'HEARING'`, `'RESOURCE'`, `'TASK'`)
- `reference_id` (String/UUID, Optional)
- `created_by` (UUID, Foreign Key -> `users.id`, Optional)
- `created_at` (Timestamp, Default: `now()`)

### 10. `chat_sessions`
- `id` (UUID, Primary Key)
- `case_id` (UUID, Foreign Key -> `cases.id`)
- `user_id` (UUID, Foreign Key -> `users.id`)
- `created_at` (Timestamp, Default: `now()`)

### 11. `chat_messages`
- `id` (UUID, Primary Key)
- `session_id` (UUID, Foreign Key -> `chat_sessions.id`)
- `role` (Enum/String - `USER`, `ASSISTANT`, `SYSTEM`)
- `content` (Text, Required)
- `created_at` (Timestamp, Default: `now()`)

### 12. `case_ai_configs`
*Custom prompt instructions and tool rules per case/firm.*
- `id` (UUID, Primary Key)
- `case_id` (UUID, Unique, Foreign Key -> `cases.id`)
- `system_instructions` (Text, Optional)
- `response_style` (String, Optional)
- `allowed_tools` (JSON / Array of Strings)
- `custom_rules` (JSON / Text, Optional)

### 13. `drafts`
*Generated or manually created legal draft documents.*
- `id` (UUID, Primary Key)
- `case_id` (UUID, Foreign Key -> `cases.id`)
- `title` (String, Required)
- `type` (String - e.g., `'AFFIDAVIT'`, `'REJOINED'`, `'NOTICE'`)
- `content` (Text, Required)
- `status` (Enum/String - `DRAFT`, `IN_REVIEW`, `FINALIZED`)
- `created_by` (UUID, Foreign Key -> `users.id`, Optional)
- `created_at` (Timestamp, Default: `now()`)

### 14. `hearing_briefs`
*Automated AI-generated preparation briefs for upcoming hearings.*
- `id` (UUID, Primary Key)
- `case_id` (UUID, Foreign Key -> `cases.id`)
- `hearing_id` (UUID, Foreign Key -> `hearings.id`)
- `content` (Text / JSON, Required)
- `generated_at` (Timestamp, Default: `now()`)

---

## 3. Scope for Future Database Evolution & Hippocampus Alignment

To accommodate future changes smoothly:
1. **Hippocampus Resource Management**: When a case is created, a corresponding collection is provisioned in Hippocampus and stored in `cases.collection_id`. All document uploads, listing, processing status, and resource IDs are handled directly through Hippocampus collection APIs.
2. **JSONB Columns for Metadata**: Flexible entities (like `case_ai_configs` and `timeline_events`) can store additional dynamic metadata in `jsonb` fields without requiring immediate schema migrations.
3. **Schema Migration Strategy**: Using Prisma or SQL migration scripts (`db/migrations/`) ensures every schema change is version-controlled and reversible.
4. **Soft Deletes**: Adding `deleted_at` timestamps to core entities (`cases`) will preserve audit trails without corrupting relations.
