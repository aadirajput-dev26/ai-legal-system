// Shared TypeScript types for the AI Legal Case Management System

// ─────────────────────────────────────────────
// RBAC Roles
// ─────────────────────────────────────────────
export type Role = 'ADMIN' | 'EDITOR' | 'VIEWER';

// ─────────────────────────────────────────────
// JWT Payload shape
// ─────────────────────────────────────────────
export interface JwtPayload {
    userId: string;
    email : string;
    name  : string;
}

declare module '@fastify/jwt' {
    interface FastifyJWT {
        payload: JwtPayload; 
        user   : JwtPayload;    
    }
}
