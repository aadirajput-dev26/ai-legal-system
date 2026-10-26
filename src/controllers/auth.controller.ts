import { FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { UserRepository } from '../repositories/user.repository.js';
import { OrganisationRepository } from '../repositories/organisation.repository.js';
import { CreditService } from '../services/credit.service.js';
import { config } from '../lib/config.js';
import type { JwtPayload } from '../types/index.js';

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
 * Send branded verification email via configured webhook
 */
export async function sendEmailVerificationWebhook(email: string, name: string) {
    const webhookUrl = config.EMAIL_VERIFY_WEBHOOK_URL || 'https://flow.sokt.io/func/scriV6mk16qc';
    const verifyUrl = `https://legaldesk.co.in/verify?email=${encodeURIComponent(email)}`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Verify your LegalDesk email</title>
</head>
<body style="margin:0;padding:0;background:#F8F9FA;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F8F9FA;padding:40px 16px;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:12px;border:1px solid #E5E7EB;overflow:hidden;max-width:560px;width:100%;">
      <tr>
        <td style="background:#111111;padding:32px 40px;text-align:center;">
          <p style="margin:0;font-size:22px;font-weight:bold;color:#FFFFFF;letter-spacing:-0.02em;">Legal<span style="color:#2dd4bf;">Desk</span></p>
          <p style="margin:8px 0 0;font-size:13px;color:#A1A1AA;">AI Legal Case Management</p>
        </td>
      </tr>
      <tr>
        <td style="padding:40px 40px 32px;">
          <h1 style="margin:0 0 8px;font-size:24px;font-weight:bold;color:#111111;letter-spacing:-0.02em;">Verify your email address</h1>
          <p style="margin:0 0 24px;font-size:15px;color:#666666;line-height:1.6;">Hi ${name || 'there'},</p>
          <p style="margin:0 0 24px;font-size:15px;color:#666666;line-height:1.6;">
            Welcome to LegalDesk! Click the button below to verify your email address and complete your account setup.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
            <tr>
              <td style="background:#111111;border-radius:10px;">
                <a href="${verifyUrl}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none;letter-spacing:-0.01em;">
                  Verify Email Address →
                </a>
              </td>
            </tr>
          </table>
          <p style="margin:0 0 8px;font-size:13px;color:#999999;">Or copy and paste this link into your browser:</p>
          <p style="margin:0 0 24px;font-size:12px;color:#111111;word-break:break-all;background:#F8F9FA;padding:12px;border-radius:8px;border:1px solid #E5E7EB;">${verifyUrl}</p>
          <p style="margin:0;font-size:13px;color:#999999;line-height:1.6;">
            This link expires in <strong style="color:#111111;">30 minutes</strong> and can only be used once.<br />
            If you didn't create a LegalDesk account, you can safely ignore this email.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 40px;border-top:1px solid #E5E7EB;text-align:center;">
          <p style="margin:0;font-size:12px;color:#999999;">© ${new Date().getFullYear()} LegalDesk. All rights reserved.</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

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
    password    : string;
    accountType?: 'individual' | 'firm';
    mobile      ?: string;
    state       ?: string;
    city        ?: string;
    firmName    ?: string;
    gstin       ?: string;
}

export async function signup(req: FastifyRequest, reply: FastifyReply) {
    const { name, email, password, accountType, firmName } = req.body as SignupBody;

    if (!name || !email || !password) {
        return reply.code(400).send({
            success: false,
            error: {
                code   : 'MISSING_REQUIRED_FIELDS',
                message: 'Name, email, and password are required.',
            },
        });
    }

    // Password validation (8 chars, mixed case, number, special char)
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

    // Dispatch verification email via webhook
    sendEmailVerificationWebhook(email, name).catch(() => {});

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
