import { FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { UserRepository } from '../repositories/user.repository.js';
import { config } from '../lib/config.js';
import type { JwtPayload } from '../types/index.js';

// In-memory revocation store for refresh tokens.
// Swap this Set for a Redis SET when Redis is added to the stack.
const revokedRefreshTokens = new Set<string>();

// ─────────────────────────────────────────────
// POST /api/v1/auth/signup
// ─────────────────────────────────────────────
interface SignupBody {
    name    : string;
    email   : string;
    password: string;
}

export async function signup(req: FastifyRequest, reply: FastifyReply) {
    const { name, email, password } = req.body as SignupBody;

    // Check for existing account
    const exists = await UserRepository.existsByEmail(email);
    if (exists) {
        return reply.code(409).send({
            success: false,
            error: {
                code   : 'EMAIL_ALREADY_EXISTS',
                message: `An account with email '${email}' already exists.`,
            },
        });
    }

    const password_hash = await bcrypt.hash(password, 12);

    const user = await UserRepository.create(name, email, password_hash);

    return reply.code(201).send({
        success: true,
        data   : { id: user.id, name: user.name, email: user.email },
    });
}

// ─────────────────────────────────────────────
// POST /api/v1/auth/login
// ─────────────────────────────────────────────
interface LoginBody {
    email   : string;
    password: string;
}

export async function login(req: FastifyRequest, reply: FastifyReply) {
    const { email, password } = req.body as LoginBody;

    const user = await UserRepository.findByEmail(email);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return reply.code(401).send({
            success: false,
            error: {
                code   : 'INVALID_CREDENTIALS',
                message: 'Email or password is incorrect.',
            },
        });
    }

    const payload: JwtPayload = { userId: user.id, email: user.email, name: user.name };

    // Access token — short-lived (15 min)
    const accessToken = req.server.jwt.sign(payload, { expiresIn: '15m' });

    // Refresh token — long-lived (7 days), signed with separate secret
    const refreshToken = req.server.jwt.sign(
        payload,
        { expiresIn: '7d', key: config.JWT_REFRESH_SECRET }
    );

    reply
        .setCookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure  : process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            path    : '/api/v1/auth/refresh',
            maxAge  : 7 * 24 * 60 * 60, // 7 days in seconds
        })
        .code(200)
        .send({
            success: true,
            data   : {
                accessToken,
                user: { id: user.id, name: user.name, email: user.email },
            },
        });
}

// ─────────────────────────────────────────────
// POST /api/v1/auth/refresh
// ─────────────────────────────────────────────
export async function refresh(req: FastifyRequest, reply: FastifyReply) {
    const refreshToken = req.cookies['refreshToken'];

    if (!refreshToken) {
        return reply.code(401).send({
            success: false,
            error: { code: 'MISSING_REFRESH_TOKEN', message: 'Refresh token cookie not found.' },
        });
    }

    if (revokedRefreshTokens.has(refreshToken)) {
        return reply.code(401).send({
            success: false,
            error: { code: 'TOKEN_REVOKED', message: 'Refresh token has been revoked. Please log in again.' },
        });
    }

    let payload: JwtPayload;
    try {
        payload = req.server.jwt.verify<JwtPayload>(
            refreshToken,
            { key: config.JWT_REFRESH_SECRET }
        );
    } catch {
        return reply.code(401).send({
            success: false,
            error: { code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token is invalid or expired.' },
        });
    }

    const newAccessToken = req.server.jwt.sign(
        { userId: payload.userId, email: payload.email, name: payload.name },
        { expiresIn: '15m' }
    );

    return reply.code(200).send({
        success: true,
        data   : { accessToken: newAccessToken },
    });
}

// ─────────────────────────────────────────────
// POST /api/v1/auth/logout
// ─────────────────────────────────────────────
export async function logout(req: FastifyRequest, reply: FastifyReply) {
    const refreshToken = req.cookies['refreshToken'];
    if (refreshToken) {
        revokedRefreshTokens.add(refreshToken);
    }

    reply
        .clearCookie('refreshToken', { path: '/api/v1/auth/refresh' })
        .code(200)
        .send({ success: true, data: { message: 'Logged out successfully.' } });
}

// ─────────────────────────────────────────────
// GET /api/v1/auth/me
// ─────────────────────────────────────────────
export async function me(req: FastifyRequest, reply: FastifyReply) {
    return reply.code(200).send({
        success: true,
        data   : req.user,
    });
}
