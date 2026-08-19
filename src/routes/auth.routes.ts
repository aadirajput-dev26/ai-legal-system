import { FastifyInstance } from 'fastify';
import { authenticate } from '../middlewares/authenticate.js';
import * as authController from '../controllers/auth.controller.js';

export async function authRoutes(app: FastifyInstance) {
    // Public routes (no auth required)
    app.post('/signup', authController.signup);
    app.post('/login',  authController.login);
    app.post('/refresh', authController.refresh);

    // Authenticated routes
    app.post('/logout', { preHandler: [authenticate] }, authController.logout);
    app.get('/me',      { preHandler: [authenticate] }, authController.me);
}
