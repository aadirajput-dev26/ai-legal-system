import { FastifyRequest, FastifyReply } from 'fastify';
import { FeeRepository } from '../repositories/fee.repository.js';
import { CaseRepository } from '../repositories/case.repository.js';
import { EmailService } from '../services/email.service.js';

export async function getFeesSummary(req: FastifyRequest, reply: FastifyReply) {
    const { id: caseId } = req.params as { id: string };
    
    const caseObj = await CaseRepository.findById(caseId);
    if (!caseObj) return reply.status(404).send({ error: 'Case not found' });

    const summary = await FeeRepository.getFeesSummary(caseId);
    const milestones = await FeeRepository.getMilestones(caseId);
    const payments = await FeeRepository.getPayments(caseId);

    return reply.send({
        success: true,
        data: {
            summary,
            milestones,
            payments
        }
    });
}

export async function updateFeeSchedule(req: FastifyRequest, reply: FastifyReply) {
    const { id: caseId } = req.params as { id: string };
    const { total_agreed_fee } = req.body as { total_agreed_fee: number };

    if (total_agreed_fee === undefined) return reply.status(400).send({ error: 'total_agreed_fee is required' });

    const caseObj = await CaseRepository.findById(caseId);
    if (!caseObj) return reply.status(404).send({ error: 'Case not found' });

    const updated = await FeeRepository.updateFeeSchedule(caseId, total_agreed_fee);
    return reply.send({ success: true, data: updated });
}

export async function createMilestone(req: FastifyRequest, reply: FastifyReply) {
    const { id: caseId } = req.params as { id: string };
    const { stage_name, amount, due_date } = req.body as { stage_name: string, amount: number, due_date?: string };

    if (!stage_name || amount === undefined) return reply.status(400).send({ error: 'stage_name and amount are required' });

    const caseObj = await CaseRepository.findById(caseId);
    if (!caseObj) return reply.status(404).send({ error: 'Case not found' });

    const milestone = await FeeRepository.createMilestone(caseId, stage_name, amount, due_date);
    return reply.send({ success: true, data: milestone });
}

export async function recordPayment(req: FastifyRequest, reply: FastifyReply) {
    const { id: caseId } = req.params as { id: string };
    const { milestone_id, amount_paid, payment_mode, receipt_number, notes } = req.body as any;

    if (amount_paid === undefined) return reply.status(400).send({ error: 'amount_paid is required' });

    const caseObj = await CaseRepository.findById(caseId);
    if (!caseObj) return reply.status(404).send({ error: 'Case not found' });

    const payment = await FeeRepository.recordPayment(caseId, milestone_id, amount_paid, payment_mode || 'BANK_TRANSFER', receipt_number, notes);
    const summary = await FeeRepository.getFeesSummary(caseId);
    
    // Asynchronously send email receipt without blocking response
    const userId = (req as any).user?.id || null;
    EmailService.sendFeeReceipt(caseId, { ...payment, outstanding_balance: summary.outstanding_balance }, caseObj, userId).catch(err => {
      console.error('Email dispatch failed:', err);
    });

    return reply.send({ success: true, data: payment });
}
