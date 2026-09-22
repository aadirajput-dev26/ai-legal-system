import { FastifyRequest, FastifyReply } from 'fastify';
import pool from '../lib/db.js';
import { CreditService } from '../services/credit.service.js';
import { billingConfig } from '../lib/billing-config.js';

/**
 * checkCredits — the pre-request gate in front of every AI operation.
 *
 * It is a single indexed SUM, so it adds ~2ms. It runs BEFORE the Gateway is
 * called, so an organisation that cannot pay never incurs a cost.
 *
 * It fails OPEN. If the balance cannot be read, the lawyer gets their answer
 * and we lose the enforcement on one request. Refusing to work because the
 * billing table is unreachable would be the worse failure.
 */
export async function checkCredits(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!billingConfig.enforcementEnabled) return;

    try {
        const caseId = (req.params as any)?.id;
        if (!caseId) return;

        const r = await pool.query(`SELECT organisation_id FROM cases WHERE id = $1`, [caseId]);
        const organisationId = r.rows[0]?.organisation_id;
        if (!organisationId) return;

        const verdict = await CreditService.canSpend(organisationId);
        if (verdict.allowed) return;

        reply.status(402).send({
            success: false,
            error: {
                code: verdict.reason,
                message: verdict.reason === 'NO_SUBSCRIPTION'
                    ? 'This organisation does not have an active plan. Choose a plan to start using LegalDesk AI.'
                    : `You have ${verdict.balanceCredits.toLocaleString('en-IN')} ${billingConfig.creditLabel.toLowerCase()} left, which is below the minimum needed to run this. Add more to continue.`,
                balanceCredits: verdict.balanceCredits,
                minBalanceCredits: billingConfig.minBalanceCredits,
                action: 'TOPUP',
            },
        });
    } catch (err) {
        req.log.error(err, '[billing] credit check failed — allowing the request through');
    }
}
