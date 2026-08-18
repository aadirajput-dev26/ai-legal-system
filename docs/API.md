# API Specification - AI Legal Case Management System

## 1. Overview
The API is built using **Fastify** with TypeScript. All endpoints strictly validate incoming request payloads and query parameters using **Zod** schema validation.

- **Base URL**: `/api/v1`
- **Content-Type**: `application/json`
- **Authentication**: Bearer JWT Token in `Authorization` header (`Authorization: Bearer <access_token>`)
- **Refresh Token**: HTTP-Only Secure Cookie (`refreshToken`)

---

## 2. API Endpoints Specification

### A. Authentication & User Profile
| Method | Endpoint | Description | Access |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/signup` | Register a new user account | Public |
| `POST` | `/api/v1/auth/login` | Authenticate user, issue access token & refresh cookie | Public |
| `POST` | `/api/v1/auth/refresh` | Renew short-lived access token using refresh cookie | Public (Cookie) |
| `POST` | `/api/v1/auth/logout` | Revoke session & clear refresh cookie | Authenticated |
| `GET` | `/api/v1/auth/me` | Fetch authenticated user profile | Authenticated |

---

### B. Organisation & Member Management
| Method | Endpoint | Description | Required Role |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/organisations` | List all organisations current user belongs to | Authenticated |
| `POST` | `/api/v1/organisations` | Create a new law firm organisation (User becomes Org `ADMIN`) | Authenticated |
| `GET` | `/api/v1/organisations/:id` | Get firm details and summary | Org Member (`ADMIN`, `EDITOR`, `VIEWER`) |
| `GET` | `/api/v1/organisations/:id/members` | List all members of an organisation | Org Member (`ADMIN`, `EDITOR`, `VIEWER`) |
| `POST` | `/api/v1/organisations/:id/members` | Invite member to org by email (Errors if user account doesn't exist) | Org `ADMIN` |
| `PATCH` | `/api/v1/organisations/:id/members/:userId` | Update member role (`ADMIN`, `EDITOR`, `VIEWER`) | Org `ADMIN` |
| `DELETE` | `/api/v1/organisations/:id/members/:userId` | Remove member from organisation | Org `ADMIN` |

---

### C. Case Workspace Management
| Method | Endpoint | Description | Required Role |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/organisations/:id/cases` | List accessible cases in an organisation | Org Member (`ADMIN`, `EDITOR`, `VIEWER`) |
| `POST` | `/api/v1/organisations/:id/cases` | Create a new case workspace (Auto-creates Hippocampus collection) | Org `ADMIN`, `EDITOR` |
| `GET` | `/api/v1/cases/:id` | Fetch case details, overview, and status | Case Member (`ADMIN`, `EDITOR`, `VIEWER`) |
| `PATCH` | `/api/v1/cases/:id` | Update case metadata (title, court, next hearing, status) | Case `ADMIN`, `EDITOR` |
| `DELETE` | `/api/v1/cases/:id` | Delete or archive a case workspace | Case `ADMIN` |

---

### D. Case Member Management
| Method | Endpoint | Description | Required Role |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/cases/:id/members` | List members assigned to a case | Case Member (`ADMIN`, `EDITOR`, `VIEWER`) |
| `POST` | `/api/v1/cases/:id/members` | Add an org member to a case (Errors if user is not in Org) | Case `ADMIN` |
| `PATCH` | `/api/v1/cases/:id/members/:userId` | Update case member role (`ADMIN`, `EDITOR`, `VIEWER`) | Case `ADMIN` |
| `DELETE` | `/api/v1/cases/:id/members/:userId` | Remove member from a case | Case `ADMIN` |

---

### E. Hearings & Orders
| Method | Endpoint | Description | Required Role |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/cases/:id/hearings` | Get hearing history for a case | Case Member (`ADMIN`, `EDITOR`, `VIEWER`) |
| `POST` | `/api/v1/cases/:id/hearings` | Record a new hearing | Case `ADMIN`, `EDITOR` |
| `PATCH` | `/api/v1/hearings/:id` | Update hearing summary, outcome, and next hearing date | Case `ADMIN`, `EDITOR` |
| `POST` | `/api/v1/hearings/:id/orders` | Record an order linked to a hearing | Case `ADMIN`, `EDITOR` |
| `GET` | `/api/v1/cases/:id/briefs/upcoming` | Fetch AI-generated hearing brief for upcoming date | Case Member (`ADMIN`, `EDITOR`, `VIEWER`) |

---

### F. Document Resources (Hippocampus RAG Integration)
| Method | Endpoint | Description | Required Role |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/cases/:id/resources` | Upload document resource to case's Hippocampus collection | Case `ADMIN`, `EDITOR` |
| `GET` | `/api/v1/cases/:id/resources` | List all document resources via Hippocampus collection API | Case Member (`ADMIN`, `EDITOR`, `VIEWER`) |
| `GET` | `/api/v1/cases/:id/resources/:resourceId` | Fetch resource metadata and status from Hippocampus | Case Member (`ADMIN`, `EDITOR`, `VIEWER`) |
| `DELETE` | `/api/v1/cases/:id/resources/:resourceId` | Remove resource from case's Hippocampus collection | Case `ADMIN`, `EDITOR` |

---

### G. AI Agent, Chat & Legal Drafting
| Method | Endpoint | Description | Required Role |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/cases/:id/chat/sessions` | Create a new chat session for a case | Case Member (`ADMIN`, `EDITOR`, `VIEWER`) |
| `POST` | `/api/v1/chat/sessions/:id/messages` | Send message to AI Case Assistant (Streaming response) | Case Member (`ADMIN`, `EDITOR`, `VIEWER`) |
| `GET` | `/api/v1/chat/sessions/:id/messages` | Fetch chat message history | Case Member (`ADMIN`, `EDITOR`, `VIEWER`) |
| `POST` | `/api/v1/cases/:id/drafts/generate` | Trigger AI legal draft generation | Case `ADMIN`, `EDITOR` |
| `GET` | `/api/v1/cases/:id/drafts` | List all drafts in a case | Case Member (`ADMIN`, `EDITOR`, `VIEWER`) |

---

### H. Tasks & Timeline Audit Trail
| Method | Endpoint | Description | Required Role |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/cases/:id/tasks` | Get pending/completed tasks for a case | Case Member (`ADMIN`, `EDITOR`, `VIEWER`) |
| `POST` | `/api/v1/cases/:id/tasks` | Create a new task | Case `ADMIN`, `EDITOR` |
| `PATCH` | `/api/v1/tasks/:id` | Update task status, priority, or assignee | Case `ADMIN`, `EDITOR` |
| `GET` | `/api/v1/cases/:id/timeline` | Fetch chronological activity/timeline events | Case Member (`ADMIN`, `EDITOR`, `VIEWER`) |

---

## 3. Standardized Response & Error Schema

### Success Response (`200 OK` / `201 Created`)
```json
{
  "success": true,
  "data": {
    "id": "case_12345",
    "title": "State vs. Sharma",
    "status": "OPEN",
    "collection_id": "col_hip_98765"
  }
}
```

### Member Not Found Error (`404 Not Found`)
```json
{
  "success": false,
  "error": {
    "code": "USER_NOT_FOUND",
    "message": "User account with email 'advocate@example.com' does not exist. The user must sign up first before being added to an organisation."
  }
}
```

### Access Denied Error (`403 Forbidden`)
```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_PERMISSIONS",
    "message": "Role 'VIEWER' is not authorized to perform CRUD operations on this resource."
  }
}
```
