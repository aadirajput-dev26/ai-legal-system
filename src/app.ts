import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import postgres from '@fastify/postgres';
import multipart from '@fastify/multipart';
import { config } from './lib/config.js';
import { authRoutes } from './routes/auth.routes.js';
import { organisationRoutes } from './routes/organisation.routes.js';
import { caseRoutes } from './routes/case.routes.js';
import { notificationRoutes } from './routes/notification.routes.js';
import { legalUpdateRoutes } from './routes/legal-update.routes.js';
import { billingRoutes } from './routes/billing.routes.js';

export const App = () => {
    const app = Fastify({
        logger: {
            level: config.LOG_LEVEL
        }
    });

    // ── Plugins ────────────────────────────────────────────────────
    const ALLOWED_ORIGINS = [
        'https://legaldesk-two.vercel.app',
        'http://legaldesk-two.vercel.app',
        'https://legaldesk.co.in',
        'http://legaldesk.co.in',
        'https://www.legaldesk.co.in',
        'http://www.legaldesk.co.in',
        'http://localhost:3000',
        'http://localhost:5173',
        'http://localhost:8080',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:5173',
    ];

    const ALLOWED_ORIGIN_PATTERNS = [
        /^https?:\/\/([a-zA-Z0-9-]+\.)?legaldesk-two\.vercel\.app$/,
        /^https?:\/\/([a-zA-Z0-9-]+\.)?legaldesk\.co\.in$/,
        /^https?:\/\/([a-zA-Z0-9-]+\.)?vercel\.app$/,
        /^https?:\/\/localhost(:\d+)?$/,
        /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
    ];

    // Support Chrome Private Network Access (PNA) for public HTTPS -> local HTTP requests
    app.addHook('onRequest', async (req, reply) => {
        if (req.headers['access-control-request-private-network']) {
            reply.header('Access-Control-Allow-Private-Network', 'true');
        }
    });

    app.addHook('onSend', async (req, reply) => {
        if (req.headers['access-control-request-private-network']) {
            reply.header('Access-Control-Allow-Private-Network', 'true');
        }
    });

    app.register(cors, {
        origin: (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
            // Allow requests with no origin or null origin (e.g. server-to-server, curl, Postman, webhooks, privacy mode)
            if (!origin || origin === 'null') {
                return cb(null, true);
            }

            // Check explicit allowed origins list
            if (ALLOWED_ORIGINS.includes(origin)) {
                return cb(null, true);
            }

            // Check wildcard / regex patterns (subdomains, vercel previews, local dev ports)
            if (ALLOWED_ORIGIN_PATTERNS.some(pattern => pattern.test(origin))) {
                return cb(null, true);
            }

            // Check CORS_ORIGINS from environment variables (comma-separated)
            if (config.CORS_ORIGINS) {
                const extraOrigins = config.CORS_ORIGINS.split(',').map(s => s.trim());
                if (extraOrigins.includes(origin)) {
                    return cb(null, true);
                }
            }

            // In development mode, allow all origins
            if (process.env.NODE_ENV !== 'production') {
                return cb(null, true);
            }

            return cb(null, false);
        },
        credentials: true,
        methods    : ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
        // Omitting allowedHeaders allows Fastify to dynamically reflect Access-Control-Request-Headers
        exposedHeaders: ['X-Draft-Id', 'Set-Cookie', 'Content-Range', 'X-Content-Range'],
        maxAge     : 86400,
    });

    app.register(cookie);
    app.register(multipart);

    app.register(jwt, {
        secret: config.JWT_ACCESS_SECRET,
        // Refresh token uses its own secret — verified manually in the controller
    });

    app.register(postgres, { connectionString: config.DATABASE_URL });

    // ── Raw body, kept ONLY for the Razorpay webhook ───────────────
    // The webhook HMAC is computed over the EXACT bytes Razorpay sent, so
    // JSON.parse + re-stringify would break it. Fastify content-type parsers
    // are app-wide, so this one runs for every JSON request — but it retains
    // the raw string only for the webhook path. Every other route parses as
    // before and holds no extra copy of its body.
    const RAW_BODY_PATHS = ['/webhooks/razorpay'];
    app.addContentTypeParser(
        'application/json',
        { parseAs: 'string' },
        (req: any, body: string, done: any) => {
            if (RAW_BODY_PATHS.some(p => (req.url || '').startsWith(p) || (req.url || '').includes(p))) {
                req.rawBody = body;
            }
            try {
                done(null, body && body.length ? JSON.parse(body) : {});
            } catch (err: any) {
                err.statusCode = 400;
                done(err, undefined);
            }
        },
    );

    // ── Health Check ───────────────────────────────────────────────
    app.get('/', () => ({
        success: true,
        health : 'ok',
        message: 'AI Legal System API is running.',
    }));

    // ── Routes ─────────────────────────────────────────────────────
    app.register(authRoutes,         { prefix: '/api/v1/auth' });
    app.register(organisationRoutes, { prefix: '/api/v1/organisations' });
    app.register(caseRoutes,         { prefix: '/api/v1' });
    app.register(caseRoutes,         { prefix: '' });
    app.register(notificationRoutes, { prefix: '/api/v1' });
    app.register(legalUpdateRoutes,  { prefix: '/api/v1' });
    app.register(billingRoutes,      { prefix: '/api/v1' });

    return app;
};
