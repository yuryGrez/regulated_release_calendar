import logger from '../logger.js';

const LEVEL_EMOJI  = { SAFE: '✅', AT_RISK: '⚠️', BLOCKED: '🚨' };
const LEVEL_COLOUR = { SAFE: '#16a34a', AT_RISK: '#d97706', BLOCKED: '#dc2626' };

/**
 * Post a Slack message for a RiskScoreComputed event.
 * @param {object} event        RiskScoreComputed message
 * @param {string} webhookUrl   Per-tenant Slack incoming webhook URL
 */
export async function sendSlackNotification(event, webhookUrl) {
  if (!webhookUrl) {
    logger.debug({ msg: 'No Slack webhook configured', tenant_id: event.tenant_id });
    return;
  }

  const emoji = LEVEL_EMOJI[event.level]  ?? '•';
  const color = LEVEL_COLOUR[event.level] ?? '#6b7280';

  const reasonFields = (event.reasons ?? []).map((r) => ({
    title: r.window_name,
    value: `+${r.points} pts`,
    short: true,
  }));

  const payload = {
    attachments: [{
      color,
      fallback: `${emoji} ${event.level}: ${event.release_name ?? event.release_id} (${event.score}/100)`,
      title:    `${emoji} Release ${event.level}: ${event.release_name ?? event.release_id}`,
      fields:   [
        { title: 'Planned date', value: event.planned_date, short: true },
        { title: 'Risk score',   value: `${event.score} / 100`,  short: true },
        ...reasonFields,
      ],
      footer: 'Regulated Release Calendar',
      ts:     Math.floor(Date.now() / 1000),
    }],
  };

  try {
    const res = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (!res.ok) {
      logger.error({ msg: 'slack_send_failed', status: res.status, release_id: event.release_id });
    } else {
      logger.info({ msg: 'slack_sent', release_id: event.release_id, level: event.level });
    }
  } catch (err) {
    logger.error({ msg: 'slack_error', error: err.message, release_id: event.release_id });
  }
}
