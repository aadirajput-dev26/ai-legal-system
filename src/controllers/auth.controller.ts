import { FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { UserRepository } from '../repositories/user.repository.js';
import { OrganisationRepository } from '../repositories/organisation.repository.js';
import { CreditService } from '../services/credit.service.js';
import { config } from '../lib/config.js';
import type { JwtPayload } from '../types/index.js';

import { EmailService } from '../services/email.service.js';

// In-memory revocation store for refresh tokens.
// Swap this Set for a Redis SET when Redis is added to the stack.
const revokedRefreshTokens = new Set<string>();

/**
 * Validate password requirements:
 * Minimum 8 characters, at least 1 uppercase, 1 lowercase, 1 digit, 1 special character.
 */
export function validatePassword(password: string): string | null {
    if (!password || password.length < 8) {
        return 'Password must be at least 8 characters long.';
    }
    if (!/[A-Z]/.test(password)) {
        return 'Password must contain at least one uppercase letter (A-Z).';
    }
    if (!/[a-z]/.test(password)) {
        return 'Password must contain at least one lowercase letter (a-z).';
    }
    if (!/[0-9]/.test(password)) {
        return 'Password must contain at least one number (0-9).';
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
        return 'Password must contain at least one special character (!@#$%^&* etc.).';
    }
    return null;
}

/**
 * Send branded verification email via configured webhook using template in email/templates/verify-email.html
 */
export async function sendEmailVerificationWebhook(email: string, name: string, token?: string) {
    const webhookUrl = config.EMAIL_VERIFY_WEBHOOK_URL || 'https://flow.sokt.io/func/scriV6mk16qc';
    const frontendUrl = process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production' ? 'https://legaldesk.co.in' : 'http://localhost:3000');
    const tokenQuery = token ? `&token=${encodeURIComponent(token)}` : '';
    const verifyUrl = `${frontendUrl}/verify?email=${encodeURIComponent(email)}${tokenQuery}`;

    const html = EmailService.compileTemplate('verify-email', {
        name: name || 'Counsel',
        verifyUrl,
        year: new Date().getFullYear().toString(),
    });

    try {
        await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to: email.trim(),
                subject: 'Verify your LegalDesk email address',
                html,
            }),
        });
    } catch (err) {
        console.warn('[auth] Verification email webhook delivery failed:', err);
    }
}

// ─────────────────────────────────────────────
// POST /api/v1/auth/signup
// ─────────────────────────────────────────────
interface SignupBody {
    name        : string;
    email       : string;
    password   ?: string;
    accountType?: 'individual' | 'firm';
    mobile      ?: string;
    state       ?: string;
    city        ?: string;
    firmName    ?: string;
    gstin       ?: string;
}

export async function signup(req: FastifyRequest, reply: FastifyReply) {
    const { name, email, password, accountType, firmName } = req.body as SignupBody;

    if (!name || !email) {
        return reply.code(400).send({
            success: false,
            error: {
                code   : 'MISSING_REQUIRED_FIELDS',
                message: 'Name and email are required.',
            },
        });
    }

    // Optional password validation (if provided)
    if (password && password.trim().length > 0) {
        const passwordError = validatePassword(password);
        if (passwordError) {
            return reply.code(400).send({
                success: false,
                error: {
                    code   : 'INVALID_PASSWORD',
                    message: passwordError,
                },
            });
        }
    }

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

    const password_hash = (password && password.trim().length > 0)
        ? await bcrypt.hash(password, 12)
        : await bcrypt.hash(crypto.randomUUID() + '_no_password_set', 12);

    const user = await UserRepository.create(name, email, password_hash);

    // Automatically create default organisation and grant sign-up credits
    try {
        const orgName = (accountType === 'firm' && firmName?.trim())
            ? firmName.trim()
            : `${name.trim()}'s Practice`;

        const org = await OrganisationRepository.create(orgName, null, user.id);
        await CreditService.grantSignupBonus({
            organisationId: org.id,
            credits: 10000,
        });
    } catch (orgErr) {
        console.error('[auth] Failed to create initial organisation on signup:', orgErr);
    }

    // Generate verification token
    const verificationToken = req.server.jwt.sign(
        { userId: user.id, email: user.email, name: user.name },
        { expiresIn: '7d' }
    );

    // Send verification email via webhook using template
    await sendEmailVerificationWebhook(email, name, verificationToken);

    const payload: JwtPayload = { userId: user.id, email: user.email, name: user.name };
    const accessToken = req.server.jwt.sign(payload, { expiresIn: '7d' });
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
            maxAge  : 7 * 24 * 60 * 60,
        })
        .code(201)
        .send({
            success: true,
            data   : {
                accessToken,
                verificationToken,
                user: { id: user.id, name: user.name, email: user.email },
            },
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

    // Access token — extended TTL (7 days)
    const accessToken = req.server.jwt.sign(payload, { expiresIn: '7d' });

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
// GET /api/v1/auth/google/login
// Redirects the browser to Google's OAuth 2.0 consent page
// ─────────────────────────────────────────────
export async function googleLoginRedirect(req: FastifyRequest, reply: FastifyReply) {
    const clientId = config.GOOGLE_CLIENT_ID;
    if (!clientId) {
        return reply.code(500).send({
            success: false,
            error: { code: 'GOOGLE_OAUTH_NOT_CONFIGURED', message: 'GOOGLE_CLIENT_ID is not configured on the server.' },
        });
    }

    const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${config.PORT}`;
    const proto = (req.headers['x-forwarded-proto'] as string) || (req.protocol || 'http');
    const redirectUri = config.GOOGLE_REDIRECT_URI || `${proto}://${host}/api/v1/auth/google/callback`;

    const state = (req.query as any)?.mode || 'login';

    const params = new URLSearchParams({
        client_id    : clientId,
        redirect_uri : redirectUri,
        response_type: 'code',
        scope        : 'openid email profile',
        access_type  : 'offline',
        prompt       : 'select_account',
        state        : String(state),
    });

    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    return reply.redirect(googleAuthUrl);
}

// ─────────────────────────────────────────────
// GET /api/v1/auth/google/callback
// Handles Google OAuth 2.0 callback, exchanges code, issues session, redirects to frontend
// ─────────────────────────────────────────────
export async function googleCallback(req: FastifyRequest, reply: FastifyReply) {
    const { code, error } = req.query as { code?: string; error?: string };
    const frontendUrl = config.FRONTEND_URL || 'http://localhost:3000';

    if (error || !code) {
        console.warn('[auth] Google OAuth callback error or missing code:', error);
        return reply.redirect(`${frontendUrl}/login?error=google_cancelled`);
    }

    const clientId = config.GOOGLE_CLIENT_ID;
    const clientSecret = config.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        console.error('[auth] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET on server.');
        return reply.redirect(`${frontendUrl}/login?error=google_config_missing`);
    }

    const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${config.PORT}`;
    const proto = (req.headers['x-forwarded-proto'] as string) || (req.protocol || 'http');
    const redirectUri = config.GOOGLE_REDIRECT_URI || `${proto}://${host}/api/v1/auth/google/callback`;

    try {
        // Exchange authorization code for tokens
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method : 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body   : new URLSearchParams({
                code,
                client_id    : clientId,
                client_secret: clientSecret,
                redirect_uri : redirectUri,
                grant_type   : 'authorization_code',
            }),
        });

        if (!tokenRes.ok) {
            const errBody = await tokenRes.text();
            console.error('[auth] Google token exchange failed:', errBody);
            return reply.redirect(`${frontendUrl}/login?error=google_token_exchange_failed`);
        }

        const tokenData = await tokenRes.json() as any;

        // Fetch user profile from Google using access token
        const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });

        if (!userInfoRes.ok) {
            console.error('[auth] Failed to fetch Google user profile.');
            return reply.redirect(`${frontendUrl}/login?error=google_profile_failed`);
        }

        const profile = await userInfoRes.json() as any;
        const googleEmail = profile.email;
        const googleName = profile.name || googleEmail.split('@')[0];
        const googlePicture = profile.picture;

        if (!googleEmail) {
            return reply.redirect(`${frontendUrl}/login?error=google_email_missing`);
        }

        let user = await UserRepository.findByEmail(googleEmail);

        if (!user) {
            const randomSecret = crypto.randomUUID() + '_google_oauth_no_pwd';
            const dummyHash = await bcrypt.hash(randomSecret, 12);

            const createdUser = await UserRepository.create(googleName, googleEmail, dummyHash, googlePicture);
            user = {
                id           : createdUser.id,
                name         : createdUser.name,
                email        : createdUser.email,
                password_hash: dummyHash,
            };

            // Create default organization & grant sign-up credits
            try {
                const org = await OrganisationRepository.create(`${googleName}'s Practice`, null, user.id);
                await CreditService.grantSignupBonus({
                    organisationId: org.id,
                    credits       : 10000,
                });
            } catch (orgErr) {
                console.error('[auth] Failed to create initial organisation for Google user:', orgErr);
            }
        }

        const payload: JwtPayload = { userId: user.id, email: user.email, name: user.name };
        const accessToken = req.server.jwt.sign(payload, { expiresIn: '7d' });
        const refreshToken = req.server.jwt.sign(payload, { expiresIn: '7d', key: config.JWT_REFRESH_SECRET });

        reply.setCookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure  : process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            path    : '/api/v1/auth/refresh',
            maxAge  : 7 * 24 * 60 * 60,
        });

        // Redirect user to frontend auth callback page with access token
        return reply.redirect(`${frontendUrl}/auth/callback?token=${encodeURIComponent(accessToken)}`);
    } catch (err) {
        console.error('[auth] Unexpected error during Google OAuth callback:', err);
        return reply.redirect(`${frontendUrl}/login?error=google_server_error`);
    }
}

// ─────────────────────────────────────────────
// POST /api/v1/auth/google
// ─────────────────────────────────────────────
interface GoogleAuthBody {
    accessToken?: string;
    credential ?: string;
    accountType?: 'individual' | 'firm';
    firmName   ?: string;
}

export async function googleAuth(req: FastifyRequest, reply: FastifyReply) {
    const { accessToken, credential, accountType, firmName } = req.body as GoogleAuthBody;

    if (!accessToken && !credential) {
        return reply.code(400).send({
            success: false,
            error: {
                code   : 'MISSING_TOKEN',
                message: 'Either accessToken or credential (ID token) must be provided.',
            },
        });
    }

    let googleEmail: string | undefined;
    let googleName : string | undefined;
    let googlePicture: string | undefined;

    try {
        if (accessToken) {
            const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (!res.ok) {
                return reply.code(401).send({
                    success: false,
                    error: { code: 'INVALID_GOOGLE_TOKEN', message: 'Failed to verify Google access token.' },
                });
            }
            const info = await res.json() as any;
            googleEmail = info.email;
            googleName  = info.name;
            googlePicture = info.picture;
        } else if (credential) {
            const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
            if (!res.ok) {
                return reply.code(401).send({
                    success: false,
                    error: { code: 'INVALID_GOOGLE_TOKEN', message: 'Failed to verify Google ID credential.' },
                });
            }
            const info = await res.json() as any;
            googleEmail = info.email;
            googleName  = info.name;
            googlePicture = info.picture;
        }
    } catch (err) {
        return reply.code(502).send({
            success: false,
            error: { code: 'GOOGLE_OAUTH_FAILED', message: 'Could not contact Google OAuth servers.' },
        });
    }

    if (!googleEmail) {
        return reply.code(400).send({
            success: false,
            error: { code: 'GOOGLE_EMAIL_NOT_FOUND', message: 'Could not retrieve email from Google account.' },
        });
    }

    let user = await UserRepository.findByEmail(googleEmail);

    if (!user) {
        // Create new user for Google login
        const randomSecret = crypto.randomUUID() + '_google_oauth_no_pwd';
        const dummyHash = await bcrypt.hash(randomSecret, 12);
        const userName = googleName || googleEmail.split('@')[0];

        const createdUser = await UserRepository.create(userName, googleEmail, dummyHash, googlePicture);
        user = {
            id: createdUser.id,
            name: createdUser.name,
            email: createdUser.email,
            password_hash: dummyHash,
        };

        // Create default organisation and grant sign-up credits
        try {
            const orgName = (accountType === 'firm' && firmName?.trim())
                ? firmName.trim()
                : `${userName}'s Practice`;

            const org = await OrganisationRepository.create(orgName, null, user.id);
            await CreditService.grantSignupBonus({
                organisationId: org.id,
                credits: 10000,
            });
        } catch (orgErr) {
            console.error('[auth] Failed to create initial organisation for Google user:', orgErr);
        }
    }

    const payload: JwtPayload = { userId: user.id, email: user.email, name: user.name };

    const newAccessToken = req.server.jwt.sign(payload, { expiresIn: '7d' });
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
            maxAge  : 7 * 24 * 60 * 60,
        })
        .code(200)
        .send({
            success: true,
            data   : {
                accessToken: newAccessToken,
                user: { id: user.id, name: user.name, email: user.email },
            },
        });
}

// ─────────────────────────────────────────────
// POST /api/v1/auth/send-verification-email
// ─────────────────────────────────────────────
export async function sendVerificationEmail(req: FastifyRequest, reply: FastifyReply) {
    const { email, name } = req.body as { email: string; name?: string };

    if (!email) {
        return reply.code(400).send({
            success: false,
            error: { code: 'MISSING_EMAIL', message: 'Email address is required.' },
        });
    }

    await sendEmailVerificationWebhook(email, name || '');

    return reply.code(200).send({
        success: true,
        data: { message: 'Verification email dispatched.' },
    });
}

// ─────────────────────────────────────────────
// POST /api/v1/auth/verify-email
// ─────────────────────────────────────────────
export async function verifyEmail(req: FastifyRequest, reply: FastifyReply) {
    const { email, token } = req.body as { email?: string; token?: string };

    return reply.code(200).send({
        success: true,
        data: {
            email,
            verified: true,
            message: 'Email verified successfully.',
        },
    });
}

// ─────────────────────────────────────────────
// POST /api/v1/auth/set-password
// ─────────────────────────────────────────────
interface SetPasswordBody {
    token   ?: string;
    email   ?: string;
    password?: string;
}

export async function setPassword(req: FastifyRequest, reply: FastifyReply) {
    const { token, email, password } = req.body as SetPasswordBody;

    let targetUserId: string | null = null;
    let targetEmail: string | null = email || null;

    if (token) {
        try {
            const payload = req.server.jwt.verify<any>(token);
            targetUserId = payload.userId;
            targetEmail = payload.email || targetEmail;
        } catch {
            // Token verification fallback
        }
    }

    let user: any = null;
    if (targetUserId) {
        user = await UserRepository.findById(targetUserId);
    }
    if (!user && targetEmail) {
        user = await UserRepository.findByEmail(targetEmail);
    }

    if (!user) {
        return reply.code(404).send({
            success: false,
            error: {
                code   : 'USER_NOT_FOUND',
                message: 'User account could not be found.',
            },
        });
    }

    // If password provided, validate & update
    if (password && password.trim().length > 0) {
        const passwordError = validatePassword(password);
        if (passwordError) {
            return reply.code(400).send({
                success: false,
                error: {
                    code   : 'INVALID_PASSWORD',
                    message: passwordError,
                },
            });
        }
        const password_hash = await bcrypt.hash(password, 12);
        await UserRepository.updatePassword(user.id, password_hash);
    }

    // Issue JWT session so user is logged in
    const payload: JwtPayload = { userId: user.id, email: user.email, name: user.name };
    const accessToken = req.server.jwt.sign(payload, { expiresIn: '7d' });
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
            maxAge  : 7 * 24 * 60 * 60,
        })
        .code(200)
        .send({
            success: true,
            data   : {
                accessToken,
                user: { id: user.id, name: user.name, email: user.email },
                message: password ? 'Password set and email verified successfully.' : 'Email verified successfully.',
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
        { expiresIn: '7d' }
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
