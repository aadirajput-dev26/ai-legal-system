# AI Agent & Background Workers Architecture

## 1. Main Case Agent Architecture

The Main Case Agent is the core conversational intelligence interface. It operates on a single underlying LLM framework (e.g. OpenAI / Anthropic / Gemini) configured dynamically with **case-specific context**, **permissions**, and **tools**.

```
Lawyer Request ──► [ Main Case Agent ]
                        │
                        ├─► 1. Identify Intent & Case Scope
                        ├─► 2. Execute Backend Tool Calls (e.g., update_hearing, search_case_documents)
                        ├─► 3. Synthesize Authoritative Data & RAG Context
                        └─► 4. Return Grounded Response to Lawyer
```

---

## 2. Agent Tools Specification

The AI Agent interacts with the backend strictly through approved function tools:

| Tool Name | Type | Description |
| :--- | :--- | :--- |
| `get_case_details()` | Read | Retrieves authoritative metadata for the current case (parties, court, status, filing date). |
| `search_case_documents()` | Read | Executes semantic vector search via Hippocampus to find relevant document passages. |
| `get_hearing_history()` | Read | Fetches past hearing notes, orders, and scheduled future dates. |
| `create_hearing()` | Write | Creates a new hearing record in the database. |
| `update_hearing()` | Write | Updates hearing state, outcome, summary, and next hearing date. |
| `create_task()` | Write | Creates a task assigned to a team member with a due date. |
| `update_task()` | Write | Updates task status (e.g., `PENDING`, `COMPLETED`) or assignment. |
| `create_timeline_event()` | Write | Records a significant event in the case timeline audit trail. |
| `get_pending_tasks()` | Read | Fetches open/uncompleted tasks for the active case. |
| `create_draft()` | Write | Persists AI-generated legal draft text to the database for human review. |
| `get_case_context()` | Read | Builds a complete structured context payload for AI background processing. |

---

## 3. Background Workers & Jobs

Not every operation requires real-time synchronous LLM processing. Asynchronous background workers perform synthesis, extraction, and automated brief creation.

```
┌────────────────────────────────────────────────────────────────────────┐
│                          Background Queue                              │
└──────┬─────────────────┬─────────────────┬──────────────────────┬──────┘
       │                 │                 │                      │
       ▼                 ▼                 ▼                      ▼
┌──────────────┐ ┌───────────────┐ ┌───────────────┐ ┌──────────────────┐
│  Document    │ │ Hearing Brief │ │ Task Extract  │ │ Context Refresh  │
│  Processor   │ │ Generator     │ │ Worker        │ │ Worker           │
└──────────────┘ └───────────────┘ └───────────────┘ └──────────────────┘
```

### Worker Descriptions:
1. **Document Summarizer / Processor**:
   - Triggers when a PDF/document is uploaded.
   - Extracts raw text, generates a concise summary, sends metadata to primary DB, and pushes chunks to Hippocampus for embedding.
2. **Hearing Brief Generator**:
   - Nightly/scheduled job that scans for upcoming hearings tomorrow.
   - Compiles case facts, previous orders, recent timeline events, and relevant documents into a structured **Hearing Brief**.
3. **Task Extraction Worker**:
   - Scans newly uploaded court orders or hearing notes to automatically extract actionable follow-up tasks.
4. **Draft Generation Worker**:
   - Generates complex legal documents (affidavits, notices, petitions) asynchronously based on complete case history.
5. **Context Refresh Worker**:
   - Keeps pre-computed case context caches updated when new orders or documents are added.

---

## 4. Workflows

### A. Hearing Brief Generation Flow
```
Scheduler Trigger ──► Identify Tomorrow's Hearings ──► Load Case Context
                                                            │
  Notification ◄── Save to `hearing_briefs` ◄── LLM Synthesis ◄── Retrieve Docs (Hippocampus)
```

### B. AI Legal Drafting Flow
```
"Draft affidavit" ──► Identify Case ──► Load Case Context (Parties, Facts, Orders)
                                              │
  Lawyer Review ◄── Save to `drafts` ◄── Generate Draft ◄── Fetch Prior Filings
```
