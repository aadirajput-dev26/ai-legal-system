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
    app.register(cors, {
        origin     : true,
        credentials: true,
        methods    : ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Draft-Id'],
        exposedHeaders: ['X-Draft-Id'],
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
