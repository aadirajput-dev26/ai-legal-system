# Auth & Role-Based Access Control (RBAC) Specification

## 1. Executive Summary
This document defines the complete Authentication (Auth) and Role-Based Access Control (RBAC) design for the AI Legal Case Management System. Security and tenant isolation are enforced at two primary structural boundaries: **Organisation Level** and **Case Level**.

All authorization checks are executed server-side in the backend middleware layer using cryptographically signed **JSON Web Tokens (JWT)** combined with dynamic database/cache role verifications.

---

## 2. Authentication Architecture (JWT Strategy)

### A. Token Mechanics
* **Access Token (Short-Lived)**: 
  * Expiry: `15 minutes`
  * Transport: Sent in the `Authorization: Bearer <access_token>` header.
  * Claims: `userId`, `email`, `name`.
* **Refresh Token (Long-Lived)**:
  * Expiry: `7 days`
  * Transport: Stored in an `httpOnly`, `secure`, `sameSite=strict` cookie (`refreshToken`).
  * Purpose: Enables seamless token renewal without forcing the user to log in frequently.

### B. Core Authentication Flow
```
 ┌──────────────┐                  ┌────────────────┐                 ┌──────────────┐
 │    Client    │                  │  Fastify API   │                 │ Database/Redis│
 └──────┬───────┘                  └───────┬────────┘                 └──────┬───────┘
        │                                  │                                 │
        ├─► POST /api/v1/auth/signup ─────►│ Create User & Hash Password    │
        │   (email, password, name)        ├────────────────────────────────►│
        │                                  │                                 │
        ├─► POST /api/v1/auth/login ──────►│ Verify Credentials              │
        │   (email, password)              ├────────────────────────────────►│
        │                                  │ Returns AccessToken & Cookie    │
        │◄─────────────────────────────────┤                                 │
        │                                  │                                 │
        ├─► GET /api/v1/organisations ────►│ Returns user's org list + roles │
        │   (Bearer AccessToken)           ├────────────────────────────────►│
```

### C. Authentication Endpoints
1. `POST /api/v1/auth/signup`: Registers a new user account.
2. `POST /api/v1/auth/login`: Authenticates user credentials, sets HTTP-only refresh cookie, and returns access token.
3. `POST /api/v1/auth/refresh`: Issues a new access token using the refresh cookie.
4. `POST /api/v1/auth/logout`: Clears the refresh token cookie and invalidates session cache.

---

## 3. RBAC Hierarchy & Permissions Matrix

RBAC is enforced across three distinct layers (`ADMIN`, `EDITOR`, `VIEWER`) at both the **Organisation Level** and **Case Level**.

### Permission Layers

| Role | Organisation Level Permissions | Case Level Permissions |
| :--- | :--- | :--- |
| **`ADMIN`** | • Full Org & Database CRUD<br>• Create & delete cases in org<br>• Invite & remove members to/from Org<br>• Modify org settings & member roles | • Full Case CRUD<br>• Add/remove members to/from Case<br>• Delete case, modify case settings<br>• Manage AI configs & custom rules |
| **`EDITOR`** | • Create new cases in org<br>• Update org-level case data<br>• Execute all tasks/updates<br>❌ Cannot invite/remove org members | • Update case details, hearing outcomes<br>• Upload/delete case resources<br>• Create/update tasks & timeline events<br>• Generate hearing briefs & legal drafts<br>❌ Cannot invite/remove case members |
| **`VIEWER`** | • Read-only access to assigned cases<br>• Open case workspace<br>• Chat with case AI assistant<br>❌ Cannot create cases or run CRUD ops | • Read-only view of case details, timelines<br>• View hearings, orders, and drafts<br>• Chat with Case AI Assistant<br>❌ Cannot perform any CRUD operations |

---

## 4. Organisation & Case Onboarding Workflows

### Workflow A: Post-Login Organisation Discovery & Creation
1. Upon successful login/signup, the user queries `GET /api/v1/organisations`.
2. The response returns an array of organisations where the user is an active member, alongside their `role` (`ADMIN`, `EDITOR`, `VIEWER`).
3. If the user creates a new firm via `POST /api/v1/organisations`:
   - The system creates the `organisations` record.
   - The creating user is automatically assigned the `ADMIN` role in `organisation_members`.
   - Automatically provisions a default Hippocampus knowledge space if needed.

### Workflow B: Member Invitation (Org Level)
1. An `ADMIN` of the organisation navigates to the Org Members management screen and submits an invitation (`POST /api/v1/organisations/:orgId/members`).
2. **Strict Email Validation**:
   - The backend checks if a user record exists in PostgreSQL with the invited email address.
   - **Error Handling**: If no account exists for that email, the API immediately throws an HTTP `404 Not Found` error:
     ```json
     {
       "success": false,
       "error": {
         "code": "USER_NOT_FOUND",
         "message": "User account with email 'advocate@example.com' does not exist. The user must sign up first before being added to an organisation."
       }
     }
     ```
   - If the account exists, the user is added to `organisation_members` with the requested role (`ADMIN`, `EDITOR`, or `VIEWER`).

### Workflow C: Member Assignment (Case Level)
1. A Case `ADMIN` adds an existing organisation member to a specific case (`POST /api/v1/cases/:caseId/members`).
2. **Prerequisite Check**: The invited user **must** already be a member of the parent Organisation. If not, an error is returned.
3. Upon validation, a record is added to `case_members` with the specified case role.

---

## 5. Fastify Middleware & Middleware Hooks Design

Authorization is checked dynamically on incoming requests via Fastify `preHandler` hooks to ensure instantaneous enforcement if roles change.

### Middleware Execution Sequence

```
Incoming Request
      │
      ▼
┌───────────────────────────┐
│ 1. authenticate() Hook    │ ──► Decodes JWT token & sets req.user
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│ 2. requireOrgRole(...)    │ ──► Checks organisation_members table for target orgId
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│ 3. requireCaseRole(...)   │ ──► Checks case_members table for target caseId
└─────────────┬─────────────┘
              │
              ▼
    Execute Controller
```

### Hook Examples (Conceptual):
* `authenticate`: Verifies standard JWT Bearer header.
* `requireOrgRole(['ADMIN'])`: Restricts endpoint to Org Admins (e.g. Org invitations).
* `requireOrgRole(['ADMIN', 'EDITOR'])`: Restricts endpoint to Org Admins and Editors (e.g. Creating new cases).
* `requireCaseRole(['ADMIN', 'EDITOR'])`: Restricts case mutation endpoints.
* `requireCaseRole(['ADMIN', 'EDITOR', 'VIEWER'])`: Restricts reading case workspace & chatting with AI.

---

## 6. Database Entity Mapping

The RBAC system relies on the following schema relationships:

```
[users] ─── (1:N) ─── [organisation_members] ─── (N:1) ─── [organisations]
  │                                                               │
  │                                                               │
  └─────────── (1:N) ─── [case_members] ─────── (N:1) ─────── [cases]
```

- `users`: `id`, `email`, `name`, `password_hash`, `created_at`
- `organisations`: `id`, `name`, `description`, `created_at`
- `organisation_members`: `organisation_id`, `user_id`, `role` (`'ADMIN' | 'EDITOR' | 'VIEWER'`)
- `cases`: `id`, `organisation_id`, `collection_id`, `title`, `status`
- `case_members`: `case_id`, `user_id`, `role` (`'ADMIN' | 'EDITOR' | 'VIEWER'`), `joined_at`
