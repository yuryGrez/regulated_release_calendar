import sgMail from '@sendgrid/mail';
import { blockedEmailHtml, blockedEmailText } from '../templates/blocked.js';
import { atRiskEmailHtml, atRiskEmailText }   from '../templates/at-risk.js';
import logger from '../logger.js';

sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');

const FROM_EMAIL = process.env.NOTIFY_FROM_EMAIL || 'noreply@rrc.dev';

/**
 * Send a risk-score notification email.
 * @param {object} event   RiskScoreComputed message
 * @param {string} toEmail Recipient address
 */
export async function sendRiskEmail(event, toEmail) {
  if (!process.env.SENDGRID_API_KEY) {
    logger.warn({ msg: 'SENDGRID_API_KEY not set — skipping email', release_id: event.release_id });
    return;
  }

  if (event.level !== 'BLOCKED' && event.level !== 'AT_RISK') return;

  const ctx = {
    releaseName: event.release_name ?? event.release_id,
    plannedDate: event.planned_date,
    score:       event.score,
    reasons:     event.reasons ?? [],
  };

  const isBlocked = event.level === 'BLOCKED';
  const subject   = isBlocked
    ? `🚨 BLOCKED: ${ctx.releaseName} (score ${ctx.score})`
    : `⚠️ AT RISK: ${ctx.releaseName} (score ${ctx.score})`;

  const html = isBlocked ? blockedEmailHtml(ctx) : atRiskEmailHtml(ctx);
  const text = isBlocked ? blockedEmailText(ctx) : atRiskEmailText(ctx);

  try {
    await sgMail.send({ to: toEmail, from: FROM_EMAIL, subject, html, text });
    logger.info({ msg: 'email_sent', release_id: event.release_id, level: event.level, to: toEmail });
  } catch (err) {
    logger.error({ msg: 'email_failed', release_id: event.release_id, error: err.message });
  }
}
