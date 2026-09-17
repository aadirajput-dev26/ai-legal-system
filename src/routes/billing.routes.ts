import { FastifyInstance } from 'fastify';
import { authenticate } from '../middlewares/authenticate.js';
import * as billing from '../controllers/billing.controller.js';

export async function billingRoutes(app: FastifyInstance) {
    app.get('/billing/me',          { preHandler: [authenticate] }, billing.getBilling);
    app.get('/billing/statement',   { preHandler: [authenticate] }, billing.getStatement);
    app.post('/billing/subscribe',  { preHandler: [authenticate] }, billing.subscribe);
    app.post('/billing/topup',      { preHandler: [authenticate] }, billing.createTopUp);
    app.post('/billing/topup/confirm', { preHandler: [authenticate] }, billing.confirmTopUp);
    app.post('/billing/cancel',     { preHandler: [authenticate] }, billing.cancelSubscription);

    // PUBLIC. Razorpay calls this. Signature-verified inside the handler.
    app.post('/webhooks/razorpay', billing.razorpayWebhook);
}
