# Project Overview - AI Legal Case Management System

## Core Philosophy
> *"The lawyer talks. The AI understands. The database remembers. The system executes."*

---

## 1. Vision & Purpose
The **AI Legal Case Management System** is an AI-powered Legal Operating System designed for law firms and independent advocates. Rather than manually managing fragmented files, folders, hearing schedules, court orders, tasks, and timelines across multiple disconnected tools, lawyers interact primarily through a **case-specific AI assistant**.

The system balances natural-language flexibility with strict engineering controls: the AI agent understands intent and decides actions, but the backend services deterministically execute state changes and store authoritative records in the primary database.

---

## 2. Core Product Concepts

- **Organisation (Law Firm)**: The top-level tenant. A firm registers on the platform and manages its lawyers, staff, and overall workspace.
- **Cases (Primary Workspaces)**: Each legal case operates as an isolated workspace with dedicated data, documents, permissions, timeline history, and AI context.
- **Case-Specific AI Chat**: Opening a case opens a personalized, case-aware AI assistant.
- **Document Management & RAG**: Lawyers upload case documents (petitions, affidavits, evidence, orders), which are automatically processed, vectorized, and indexed into the Hippocampus/RAG knowledge layer.
- **AI Agent**: A central agent receives lawyer queries, retrieves authoritative case data and semantic document context, and executes controlled backend tools.
- **Background Automation**: Asynchronous background workers generate summaries, hearing briefs, task suggestions, and contextual legal drafts.

---

## 3. Product Hierarchy

```
Organisation (Law Firm)
 └── Members (Lawyers / Staff)
      └── Cases (Workspaces)
           ├── Case Members (Assigned Lawyers / Roles)
           ├── Hearings & Orders
           ├── Case Documents (PDFs, Petitions, Orders)
           ├── Tasks & Follow-ups
           ├── Timeline Events (Audit Trail & Activity Log)
           ├── Drafts (AI & Manual Legal Drafts)
           ├── Chat Sessions & Messages
           └── Case AI Configuration (System Prompts, Rules, Tool Permissions)
```

---

## 4. End-to-End User Flow Example

1. **Lawyer Input**: *"Update today's hearing. The judge gave 2 weeks and the next hearing is 18 August."*
2. **AI Intent Processing**: The Case AI Agent parses the request, identifies the active case context, and determines that a hearing update is required.
3. **Backend Execution**: The agent calls `update_hearing()`. The backend service updates the structured database record (`next_hearing_date = 2026-08-18`).
4. **Timeline & Tasks**: The backend automatically emits a `timeline_event` record and creates follow-up `tasks` for the legal team.
5. **Context Refresh**: The AI case context updates in real-time.
6. **Assistant Response**: The assistant confirms to the lawyer: *"Updated hearing for Aug 18, logged timeline event, and created 2 follow-up tasks."*

---

## 5. Key Engineering Principles

1. **PostgreSQL = Source of Truth**: Structured facts (dates, tasks, case status, membership) live strictly in the database. Semantic vector search complements structured data but never replaces it.
2. **AI as Decision Maker, Backend as Execution Engine**: The LLM determines *what* needs to happen; secure backend code executes *how* it happens. The LLM never executes raw database queries directly.
3. **Multi-Tenancy & Data Isolation**: Every case and document is scoped to an organisation and case ID. Cross-tenant retrieval is strictly prohibited.
4. **Grounded AI Responses**: The AI must not invent missing case facts. If information is unavailable in the database or document store, it explicitly states so.

---

## 6. 10-Day MVP Roadmap

| Day | Focus Area |
| :--- | :--- |
| **Day 1** | Architecture, Database Schema, Organisation & Auth Setup |
| **Day 2** | Cases, Case Members, and Case Workspace Dashboard |
| **Day 3** | Document Upload, Object Storage, and Processing Pipeline |
| **Day 4** | Hippocampus / RAG Integration & Document Semantic Retrieval |
| **Day 5** | Case AI Chatbot & Tool Calling Integration |
| **Day 6** | Hearings, Tasks, and Timeline Event Automation |
| **Day 7** | Automated Hearing Brief Generation |
| **Day 8** | Contextual Legal Drafting Engine |
| **Day 9** | Cloud Deployment (Railway), Permissions & Reliability Hardening |
| **Day 10** | End-to-End Demo, Testing, and Polishing |
