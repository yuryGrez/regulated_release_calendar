import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({
  region: process.env.AWS_REGION || 'eu-west-2',
  endpoint: process.env.SQS_ENDPOINT,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
  },
});

export async function publishReleaseCreated({ releaseId, tenantId, plannedDate, jurisdiction }) {
  const message = {
    type: 'ReleaseCreated',
    release_id: releaseId,
    tenant_id: tenantId,
    planned_date: plannedDate,
    jurisdiction,
  };

  await sqs.send(new SendMessageCommand({
    QueueUrl: process.env.SQS_QUEUE_URL_RELEASES,
    MessageBody: JSON.stringify(message),
    MessageGroupId: tenantId,
    MessageDeduplicationId: `${releaseId}-${plannedDate}-${Date.now()}`,
  }));
}
