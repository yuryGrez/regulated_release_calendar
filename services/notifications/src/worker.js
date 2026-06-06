/**
 * SQS consumer for the Notification Service.
 * Consumes RiskScoreComputed events and dispatches to email, Slack, Jira.
 */
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { sendRiskEmail }         from './channels/email.js';
import { sendSlackNotification } from './channels/slack.js';
import { writeJiraComment }      from './channels/jira.js';
import logger from './logger.js';

const SQS_NOTIF_URL = process.env.SQS_QUEUE_URL_NOTIFICATIONS || '';
const SQS_ENDPOINT  = process.env.SQS_ENDPOINT;

const sqs = new SQSClient({
  region: process.env.AWS_REGION || 'eu-west-2',
  endpoint: SQS_ENDPOINT,
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID     || 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
  },
});

// Per-tenant config (MVP: from env; production: fetched from DB by tenant_id)
function getTenantConfig(tenantId) {
  return {
    notifyEmail:    process.env[`NOTIFY_EMAIL_${tenantId}`]    ?? process.env.NOTIFY_EMAIL_DEFAULT,
    slackWebhook:   process.env[`SLACK_WEBHOOK_${tenantId}`]   ?? process.env.SLACK_WEBHOOK_URL,
    jiraBaseUrl:    process.env[`JIRA_BASE_URL_${tenantId}`]   ?? process.env.JIRA_BASE_URL,
    jiraToken:      process.env[`JIRA_TOKEN_${tenantId}`]      ?? process.env.JIRA_TOKEN,
    jiraIssueId:    process.env[`JIRA_ISSUE_${tenantId}`],     // optional override
  };
}

async function handleEvent(event) {
  if (event.type !== 'RiskScoreComputed') {
    logger.info({ msg: 'notification_ignored', type: event.type });
    return;
  }

  const cfg = getTenantConfig(event.tenant_id);

  await Promise.allSettled([
    cfg.notifyEmail
      ? sendRiskEmail(event, cfg.notifyEmail)
      : Promise.resolve(),

    cfg.slackWebhook
      ? sendSlackNotification(event, cfg.slackWebhook)
      : Promise.resolve(),

    // Jira write-back only if the release had a jira_version_id
    event.jira_issue_id && cfg.jiraBaseUrl && cfg.jiraToken
      ? writeJiraComment(cfg.jiraBaseUrl, event.jira_issue_id, event, cfg.jiraToken)
      : Promise.resolve(),
  ]);
}

export async function runWorker() {
  logger.info({ msg: 'notification_worker_started', queue: SQS_NOTIF_URL });

  while (true) {
    let response;
    try {
      response = await sqs.send(new ReceiveMessageCommand({
        QueueUrl:            SQS_NOTIF_URL,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds:     20,
        AttributeNames:      ['All'],
      }));
    } catch (err) {
      logger.error({ msg: 'sqs_receive_failed', error: err.message });
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    const messages = response.Messages ?? [];
    for (const msg of messages) {
      try {
        const event = JSON.parse(msg.Body);
        await handleEvent(event);
        await sqs.send(new DeleteMessageCommand({
          QueueUrl:      SQS_NOTIF_URL,
          ReceiptHandle: msg.ReceiptHandle,
        }));
      } catch (err) {
        logger.error({ msg: 'notification_processing_failed', error: err.message, message_id: msg.MessageId });
        // Leave message in queue — SQS visibility timeout + DLQ handles retries
      }
    }
  }
}
