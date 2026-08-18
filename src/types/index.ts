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

// ─────────────────────────────────────────────
// @fastify/jwt module augmentation
// This is the CORRECT way to type req.user with @fastify/jwt.
// It augments the FastifyJWT interface (not FastifyRequest directly),
// which is what @fastify/jwt uses internally to derive the user type.
// ─────────────────────────────────────────────
declare module '@fastify/jwt' {
    interface FastifyJWT {
        payload: JwtPayload; // sign() input shape
        user   : JwtPayload; // req.user shape after jwtVerify()
    }
}
