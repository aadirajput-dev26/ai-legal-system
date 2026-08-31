import { FastifyRequest, FastifyReply } from 'fastify';
import { NotificationRepository } from '../repositories/notification.repository.js';
import { OrganisationRepository } from '../repositories/organisation.repository.js';

export async function listNotifications(req: FastifyRequest, reply: FastifyReply) {
    const { userId } = req.user;
    const { orgId, isRead, type, priority, limit } = req.query as {
        orgId?: string;
        isRead?: string;
        type?: string;
        priority?: string;
        limit?: string;
    };

    // If orgId not passed, get the user's primary organisation
    let targetOrgId = orgId;
    if (!targetOrgId) {
        const orgs = await OrganisationRepository.listByUser(userId);
        if (orgs.length > 0) {
            targetOrgId = orgs[0].id;
        }
    }

    if (!targetOrgId) {
        return reply.code(200).send({ success: true, data: { notifications: [], unreadCount: 0 } });
    }

    // Auto-sync smart alerts
    await NotificationRepository.syncSmartAlerts(userId, targetOrgId).catch(err => 
        console.error('Smart alerts sync error:', err)
    );

    const isReadBool = isRead !== undefined ? isRead === 'true' : undefined;
    const limitNum = limit ? parseInt(limit, 10) : undefined;

    const data = await NotificationRepository.listByUser(userId, targetOrgId, {
        isRead: isReadBool,
        type,
        priority,
        limit: limitNum
    });

    return reply.code(200).send({ success: true, data });
}

export async function markAsRead(req: FastifyRequest, reply: FastifyReply) {
    const { userId } = req.user;
    const { id } = req.params as { id: string };

    const notification = await NotificationRepository.markAsRead(id, userId);
    if (!notification) {
        return reply.code(404).send({ success: false, error: { message: 'Notification not found' } });
    }

    return reply.code(200).send({ success: true, data: notification });
}

export async function markAsUnread(req: FastifyRequest, reply: FastifyReply) {
    const { userId } = req.user;
    const { id } = req.params as { id: string };

    const notification = await NotificationRepository.markAsUnread(id, userId);
    if (!notification) {
        return reply.code(404).send({ success: false, error: { message: 'Notification not found' } });
    }

    return reply.code(200).send({ success: true, data: notification });
}

export async function markAllAsRead(req: FastifyRequest, reply: FastifyReply) {
    const { userId } = req.user;
    const { orgId } = req.body as { orgId: string };

    if (!orgId) {
        return reply.code(400).send({ success: false, error: { message: 'orgId is required' } });
    }

    const count = await NotificationRepository.markAllAsRead(userId, orgId);
    return reply.code(200).send({ success: true, data: { markedCount: count } });
}

export async function deleteNotification(req: FastifyRequest, reply: FastifyReply) {
    const { userId } = req.user;
    const { id } = req.params as { id: string };

    const deleted = await NotificationRepository.delete(id, userId);
    if (!deleted) {
        return reply.code(404).send({ success: false, error: { message: 'Notification not found' } });
    }

    return reply.code(200).send({ success: true, data: { message: 'Notification deleted' } });
}

export async function syncAlerts(req: FastifyRequest, reply: FastifyReply) {
    const { userId } = req.user;
    const { orgId } = req.body as { orgId: string };

    if (!orgId) {
        return reply.code(400).send({ success: false, error: { message: 'orgId is required' } });
    }

    await NotificationRepository.syncSmartAlerts(userId, orgId);
    const data = await NotificationRepository.listByUser(userId, orgId);
    return reply.code(200).send({ success: true, data });
}
