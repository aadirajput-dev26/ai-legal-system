import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import postgres from '@fastify/postgres';
import { config } from './lib/config.js';
import { authRoutes } from './routes/auth.routes.js';
import { organisationRoutes } from './routes/organisation.routes.js';
import { caseRoutes } from './routes/case.routes.js';

export const App = () => {
    const app = Fastify({
        logger: {
            level: config.LOG_LEVEL
        }
    });

    // ── Plugins ────────────────────────────────────────────────────
    app.register(cors, { origin: '*' });

    app.register(cookie);

    app.register(jwt, {
        secret: config.JWT_ACCESS_SECRET,
        // Refresh token uses its own secret — verified manually in the controller
    });

    app.register(postgres, { connectionString: config.DATABASE_URL });

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

    return app;
};
