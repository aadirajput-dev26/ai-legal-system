import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../lib/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.resolve(__dirname, '../../email/templates');

export class EmailService {
  /**
   * Compiles an HTML template by replacing {{key}} with values.
   */
  static compileTemplate(templateName: string, data: Record<string, string | number>) {
    const filePath = path.join(TEMPLATES_DIR, `${templateName}.html`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Template ${templateName} not found.`);
    }

    let html = fs.readFileSync(filePath, 'utf-8');
    for (const [key, value] of Object.entries(data)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      html = html.replace(regex, String(value));
    }
    return html;
  }

  /**
   * Mock sending email to avoid SMTP blocks.
   * This handles varying connection requirements by abstracting the transport layer.
   */
  static async sendEmail(to: string, subject: string, htmlContent: string) {
    console.log(`\n[EMAIL DISPATCH] -------------------------`);
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Content length: ${htmlContent.length} bytes`);
    console.log(`------------------------------------------\n`);
    // Simulated delay
    return new Promise(resolve => setTimeout(resolve, 500));
  }

  /**
   * Dispatches a fee receipt to the client and logs it to case_communications.
   */
  static async sendFeeReceipt(caseId: string, paymentData: any, caseData: any, senderUserId: string) {
    const templateName = 'fee-receipt';
    
    // Safety check for contact details
    const clientEmail = caseData.contact_details?.client?.email;
    const clientName = caseData.contact_details?.client?.name || 'Client';

    if (!clientEmail) {
      console.warn('Cannot send fee receipt: Client email is missing.');
      return;
    }

    const html = this.compileTemplate(templateName, {
      clientName,
      caseTitle: caseData.title || 'Legal Matter',
      receiptNumber: paymentData.receipt_number || 'N/A',
      amountPaid: paymentData.amount_paid,
      paymentMode: paymentData.payment_mode,
      paymentDate: new Date(paymentData.payment_date).toLocaleDateString(),
      notes: paymentData.notes || 'None',
      outstandingBalance: paymentData.outstanding_balance || 0 // Expected to be passed in
    });

    await this.sendEmail(clientEmail, `Payment Receipt - ${caseData.title}`, html);

    // Audit log
    await pool.query(
      `INSERT INTO case_communications (case_id, sender_user_id, recipient_email, recipient_role, template_key)
       VALUES ($1, $2, $3, 'CLIENT', $4)`,
      [caseId, senderUserId, clientEmail, templateName]
    );
  }

  /**
   * Dispatches a document to the opposing counsel.
   */
  static async sendDocumentServed(caseId: string, docData: any, caseData: any, senderUserId: string) {
    const templateName = 'court-document-served';
    
    const opponentEmail = caseData.contact_details?.opponent_advocate?.email;
    const opponentName = caseData.contact_details?.opponent_advocate?.name || 'Counsel';

    if (!opponentEmail) {
      console.warn('Cannot serve document: Opposing counsel email is missing.');
      return;
    }

    const html = this.compileTemplate(templateName, {
      recipientName: opponentName,
      caseTitle: caseData.title || 'Legal Matter',
      caseNumber: caseData.case_number || 'No Ref',
      documentTitle: docData.title,
      documentDescription: docData.description || 'No description',
      documentLink: docData.url || 'Attachment unavailable', // In reality, this would be a secure download link
      senderName: 'Antigravity Legal AI System' 
    });

    await this.sendEmail(opponentEmail, `Service of Document - ${caseData.title}`, html);

    // Audit log
    await pool.query(
      `INSERT INTO case_communications (case_id, sender_user_id, recipient_email, recipient_role, template_key, document_resource_id)
       VALUES ($1, $2, $3, 'OPPONENT_ADVOCATE', $4, $5)`,
      [caseId, senderUserId, opponentEmail, templateName, docData.id]
    );
  }
}
