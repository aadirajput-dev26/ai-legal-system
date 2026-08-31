import { FastifyInstance } from 'fastify';
import { authenticate } from '../middlewares/authenticate.js';
import * as notificationController from '../controllers/notification.controller.js';

export async function notificationRoutes(app: FastifyInstance) {
    app.get('/notifications', {
        preHandler: [authenticate]
    }, notificationController.listNotifications);

    app.patch('/notifications/:id/read', {
        preHandler: [authenticate]
    }, notificationController.markAsRead);

    app.patch('/notifications/:id/unread', {
        preHandler: [authenticate]
    }, notificationController.markAsUnread);

    app.post('/notifications/mark-all-read', {
        preHandler: [authenticate]
    }, notificationController.markAllAsRead);

    app.delete('/notifications/:id', {
        preHandler: [authenticate]
    }, notificationController.deleteNotification);

    app.post('/notifications/sync', {
        preHandler: [authenticate]
    }, notificationController.syncAlerts);
}
