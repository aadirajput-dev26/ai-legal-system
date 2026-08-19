import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../lib/config.js';
import type { HearingRow } from '../repositories/hearing.repository.js';
import type { CaseDetailsRow } from '../repositories/case.repository.js';
import type { CaseMemberDetails } from '../repositories/case-member.repository.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TEMPLATE_PATH = resolve(__dirname, '../../email/templates/hearing_reminder.html');
const TEMPLATE = readFileSync(TEMPLATE_PATH, 'utf-8');

type NotificationStage = 'immediately' | '24h' | '1h';

const STAGE_META: Record<NotificationStage, { label: string; cssClass: string }> = {
    immediately : { label: 'Hearing Scheduled',    cssClass: 'immediate' },
    '24h'       : { label: '24-Hour Reminder',     cssClass: '24h'       },
    '1h'        : { label: '1-Hour Final Reminder',cssClass: '1h'        },
};

function renderTemplate(
    recipient: CaseMemberDetails,
    hearing   : HearingRow,
    caseData  : CaseDetailsRow,
    stage     : NotificationStage
): string {
    const meta         = STAGE_META[stage];
    const hearingDate  = new Date(hearing.date).toLocaleString('en-IN', {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone : 'Asia/Kolkata',
    });

    return TEMPLATE
        .replace(/{{RECIPIENT_NAME}}/g,  recipient.name)
        .replace(/{{RECIPIENT_ROLE}}/g,  recipient.role)
        .replace(/{{CASE_TITLE}}/g,      caseData.title)
        .replace(/{{CASE_NUMBER}}/g,     caseData.case_number ?? 'N/A')
        .replace(/{{COURT}}/g,           caseData.court ?? 'N/A')
        .replace(/{{HEARING_DATE}}/g,    hearingDate)
        .replace(/{{HEARING_NOTES}}/g,   hearing.notes || 'No briefing notes provided.')
        .replace(/{{STAGE_LABEL}}/g,     meta.label)
        .replace(/{{STAGE_CLASS}}/g,     meta.cssClass);
}

export interface WebhookPayload {
    type     : 'hearing_reminder';
    stage    : NotificationStage;
    case     : { id: string; title: string; case_number: string | null; court: string | null };
    hearing  : { id: string; date: Date; notes: string };
    recipients: { name: string; email: string; role: string }[];
    email_html: string; // rendered for the first recipient; your n8n flow should loop recipients
}

export class WebhookService {
    private static WEBHOOK_URL = config.NOTIFICATION_WEBHOOK_URL;

    static async sendHearingReminder(
        hearing   : HearingRow,
        caseData  : CaseDetailsRow,
        members   : CaseMemberDetails[],
        stage     : NotificationStage
    ): Promise<void> {
        if (!this.WEBHOOK_URL) {
            console.warn('[WebhookService] NOTIFICATION_WEBHOOK_URL is not set – skipping notification.');
            return;
        }

        // Build the recipient list
        const recipients = members.map(m => ({ name: m.name, email: m.email, role: m.role }));

        // Render the HTML template for the first recipient as a reference
        // (n8n / viasocket loops over recipients and personalises per-recipient)
        const emailHtml = members.length > 0
            ? renderTemplate(members[0], hearing, caseData, stage)
            : '';

        const payload: WebhookPayload = {
            type      : 'hearing_reminder',
            stage,
            case      : {
                id         : caseData.id,
                title      : caseData.title,
                case_number: caseData.case_number,
                court      : caseData.court,
            },
            hearing   : { id: hearing.id, date: hearing.date, notes: hearing.notes },
            recipients,
            email_html: emailHtml,
        };

        try {
            const res = await fetch(this.WEBHOOK_URL, {
                method : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body   : JSON.stringify(payload),
            });

            if (!res.ok) {
                const text = await res.text();
                console.error(`[WebhookService] Webhook responded with ${res.status}: ${text}`);
            } else {
                console.log(`[WebhookService] ✅ Sent "${stage}" notification for hearing ${hearing.id}`);
            }
        } catch (err: any) {
            console.error(`[WebhookService] Failed to POST to webhook: ${err.message}`);
        }
    }
}
