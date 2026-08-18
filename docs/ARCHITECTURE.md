# System Architecture - AI Legal Case Management System

## 1. Architectural Overview

The AI Legal Case Management System follows a **decoupled, event-aware, service-oriented architecture**. It strictly separates the decision-making intelligence (LLM Agent), authoritative persistence (Relational Database), semantic knowledge retrieval (RAG / Vector Index), and asynchronous background execution (Worker Queue).

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Client Application                            │
│                     (Next.js + TypeScript + Tailwind)                   │
└────────────────────┬────────────────────────────────────────────────────┘
                     │ HTTP / REST / WebSockets
                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Fastify Backend API Server                       │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────────┐  │
│  │   Auth & RBAC    │  │  Routes & Schema │  │   Controller Layer    │  │
│  └──────────────────┘  └──────────────────┘  └──────────┬────────────┘  │
│                                                         │               │
│  ┌──────────────────────────────────────────────────────▼────────────┐  │
│  │                          Service Layer                            │  │
│  └────────┬──────────────────────┬──────────────────────┬────────────┘  │
└───────────┼──────────────────────┼──────────────────────┼───────────────┘
            │                      │                      │
            ▼                      ▼                      ▼
┌──────────────────────┐ ┌──────────────────┐ ┌───────────────────────┐
│ Primary Database     │ │ AI Agent Engine  │ │ Async Workers         │
│ PostgreSQL + Prisma  │ │ LangChain / Vercel│ │ Redis + RabbitMQ      │
│ (Source of Truth)    │ │ AI SDK / OpenAI  │ │ (Background Jobs)     │
└──────────────────────┘ └─────────┬────────┘ └───────────┬───────────┘
                                   │                      │
                                   ▼                      ▼
                         ┌──────────────────────────────────┐
                         │ Knowledge Index / RAG Layer      │
                         │ Hippocampus + Qdrant             │
                         └──────────────────────────────────┘
```

---

## 2. Core Architectural Pillars

### Pillar 1: Source of Truth vs Knowledge Index
* **Primary Database (PostgreSQL)**: Holds authoritative structured data (hearing dates, orders, case status, task assignments, user access).
* **Knowledge Layer (Hippocampus/Qdrant)**: Holds vector embeddings of uploaded documents (petitions, evidence, precedent PDFs) for semantic search. The knowledge layer supports reasoning but **never overrides** primary database facts.

### Pillar 2: Agent vs Execution Engine
* **AI Agent**: Analyzes lawyer requests, forms action plans, selects appropriate tools, and formats natural language responses.
* **Backend Services**: Validate tool inputs, enforce tenant security permissions, execute database transactions, and dispatch asynchronous tasks.

---

## 3. Recommended Backend Directory Structure

```
src/
├── app.ts                 # Fastify instance creation & plugin registration
├── server.ts              # Entry point (listens on port & handles graceful shutdown)
├── lib/
│   ├── config.ts          # Zod-validated environment configurations
│   ├── db.ts              # Database client connection (PostgreSQL / Prisma)
│   ├── redis.ts           # Redis client setup
│   └── logger.ts          # Structured logger instance
├── routes/                # HTTP route registrations
│   ├── auth/
│   ├── cases/
│   ├── hearings/
│   ├── documents/
│   ├── tasks/
│   └── ai/
├── controllers/           # HTTP Request & Response handlers
│   ├── cases.controller.ts
│   ├── hearings.controller.ts
│   └── ai.controller.ts
├── services/              # Business logic & Database operations
│   ├── case.service.ts
│   ├── hearing.service.ts
│   ├── document.service.ts
│   └── task.service.ts
├── ai/                    # AI Agent & RAG engine
│   ├── agent.ts           # Main case agent router & executor
│   ├── tools.ts           # Tool definitions exposed to the LLM
│   ├── prompts.ts         # System prompts and templates
│   └── hippocampus.ts     # RAG integration module
├── workers/               # Asynchronous queue processors (RabbitMQ / BullMQ)
│   ├── document-processor.ts
│   ├── hearing-brief.worker.ts
│   └── draft-generator.worker.ts
└── middlewares/           # Authentication, RBAC, tenant validation
    ├── auth.middleware.ts
    └── tenant.middleware.ts
```

---

## 4. Multi-Tenancy & Security Model

1. **Organisation Isolation**: Every user belongs to an organisation (`law firm`). All SQL queries enforce `WHERE organisation_id = :org_id`.
2. **Case Membership**: Users are explicitly assigned to cases (`case_members`). Access to case data, documents, and chat sessions requires active case membership.
3. **Scoped RAG Search**: Vector search requests passed to Hippocampus must include `organisation_id` and `case_id` metadata filters to eliminate cross-tenant data leaks.
