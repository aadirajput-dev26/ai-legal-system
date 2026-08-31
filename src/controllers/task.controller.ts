import { FastifyRequest, FastifyReply } from 'fastify';
import { TaskRepository, CreateTaskParams, UpdateTaskParams } from '../repositories/task.repository.js';
import { CaseRepository } from '../repositories/case.repository.js';

// GET /api/v1/cases/:id/tasks
export async function listTasks(req: FastifyRequest, reply: FastifyReply) {
    const { id: caseId } = req.params as { id: string };

    const c = await CaseRepository.findById(caseId);
    if (!c) {
        return reply.code(404).send({ success: false, error: 'Case not found' });
    }

    const tasks = await TaskRepository.listByCase(caseId);
    return reply.code(200).send({ success: true, data: tasks });
}

// POST /api/v1/cases/:id/tasks
export async function createTask(req: FastifyRequest, reply: FastifyReply) {
    const { id: caseId } = req.params as { id: string };
    const body = req.body as CreateTaskParams;

    const c = await CaseRepository.findById(caseId);
    if (!c) {
        return reply.code(404).send({ success: false, error: 'Case not found' });
    }

    const task = await TaskRepository.create({
        caseId,
        title: body.title,
        description: body.description,
        status: body.status,
        dueDate: body.dueDate,
        assignedTo: body.assignedTo,
    });

    return reply.code(201).send({ success: true, data: task });
}

// PATCH /api/v1/cases/:caseId/tasks/:taskId
export async function updateTask(req: FastifyRequest, reply: FastifyReply) {
    const { taskId } = req.params as { taskId: string };
    const body = req.body as UpdateTaskParams;

    const task = await TaskRepository.update(taskId, body);

    if (!task) {
        return reply.code(404).send({ success: false, error: 'Task not found or no updates provided' });
    }

    return reply.code(200).send({ success: true, data: task });
}

// DELETE /api/v1/cases/:caseId/tasks/:taskId
export async function deleteTask(req: FastifyRequest, reply: FastifyReply) {
    const { taskId } = req.params as { taskId: string };

    const success = await TaskRepository.delete(taskId);
    if (!success) {
        return reply.code(404).send({ success: false, error: 'Task not found' });
    }

    return reply.code(200).send({ success: true, data: { message: 'Task deleted' } });
}
