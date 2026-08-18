# Infrastructure & Tech Stack - AI Legal Case Management System

## 1. Tech Stack Matrix

| Layer | MVP Recommendation | Purpose / Details |
| :--- | :--- | :--- |
| **Frontend** | Next.js + TypeScript + Tailwind CSS | Law firm dashboard, case workspace, case chatbot UI |
| **Backend API** | Node.js + TypeScript + Fastify | High performance APIs, plugins, schema validation, streaming |
| **Primary DB** | PostgreSQL + Prisma (or raw `pg`) | Authoritative relational data source of truth |
| **Cache / Session** | Redis | Rate limiting, transient session storage, job state caching |
| **Async Queue** | RabbitMQ / BullMQ | Document ingestion, background LLM workers, brief generation |
| **File Storage** | AWS S3 / Cloudflare R2 / Supabase Storage | PDF, document, and order storage |
| **RAG / Vector DB** | Hippocampus + Qdrant | Vector embedding, semantic search, document ingestion |
| **LLM Providers** | OpenAI (GPT-4o) / Gemini / Anthropic | Reasoning, extraction, summarization, legal drafting |
| **Authentication** | Clerk / Auth0 / Supabase Auth | User authentication, identity management, JWT verification |

---

## 2. Deployment Architecture (Railway Target)

The system is configured to run locally during development and deploy seamlessly to **Railway**.

```
                           ┌───────────────────────────┐
                           │      Railway Project      │
                           └─────────────┬─────────────┘
                                         │
       ┌───────────────────┬─────────────┴───────────────┬───────────────────┐
       ▼                   ▼                             ▼                   ▼
┌──────────────┐   ┌───────────────┐             ┌───────────────┐   ┌───────────────┐
│ Fastify API  │   │ Managed       │             │ Managed       │   │ Worker Service│
│ Node Service │   │ PostgreSQL DB │             │ Redis Cache   │   │ Queue Consumer│
└──────────────┘   └───────────────┘             └───────────────┘   └───────────────┘
```

- **Environment Variables**: Managed via `.env` locally and injected directly via Railway dashboard in production.
- **Port Binding**: Standardized to `PORT` environment variable (`0.0.0.0` host binding).

---

## 3. Local Development Setup (Docker)

Local database infrastructure is containerized using `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: ai_legal_postgres
    restart: always
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password123
      POSTGRES_DB: ai_legal_db
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

### Running Locally:
1. Start database: `docker compose up -d`
2. Start development server: `npm run dev` (`tsx watch src/server.ts`)
