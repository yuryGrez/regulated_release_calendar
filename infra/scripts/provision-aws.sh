#!/usr/bin/env bash
# ============================================================
# AWS Production Provisioning Script
# ============================================================
# Creates SQS FIFO queues and S3 Object Lock bucket in eu-west-2.
#
# Pre-requisites:
#   aws cli v2 installed and configured with an IAM user that has:
#     - sqs:CreateQueue, sqs:GetQueueAttributes, sqs:SetQueueAttributes
#     - s3:CreateBucket, s3:PutBucketVersioning, s3:PutObjectLockConfiguration
#     - s3:PutBucketPolicy
#
# Usage:
#   AWS_PROFILE=rrc-deploy ./infra/scripts/provision-aws.sh
#
# Idempotent — safe to run multiple times.
# ============================================================
set -euo pipefail

REGION="${AWS_REGION:-eu-west-2}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ENV="${DEPLOY_ENV:-prod}"

echo "=== RRC AWS Provisioning ==="
echo "Region:     $REGION"
echo "Account ID: $ACCOUNT_ID"
echo "Environment: $ENV"
echo ""

# ── SQS FIFO Queues ──────────────────────────────────────────────────────────

create_fifo_queue() {
  local name="$1"
  local arn_var="$2"

  echo "Creating SQS queue: $name"

  local url
  url=$(aws sqs create-queue \
    --queue-name "${name}" \
    --attributes '{
      "FifoQueue":                  "true",
      "ContentBasedDeduplication":  "false",
      "VisibilityTimeout":          "30",
      "MessageRetentionPeriod":     "86400",
      "ReceiveMessageWaitTimeSeconds": "20"
    }' \
    --region "$REGION" \
    --query 'QueueUrl' \
    --output text)

  echo "  URL: $url"
  eval "$arn_var='arn:aws:sqs:${REGION}:${ACCOUNT_ID}:${name}'"
}

create_fifo_queue "rrc-${ENV}-releases.fifo"      RELEASES_ARN
create_fifo_queue "rrc-${ENV}-notifications.fifo"  NOTIF_ARN
create_fifo_queue "rrc-${ENV}-releases-dlq.fifo"  RELEASES_DLQ_ARN
create_fifo_queue "rrc-${ENV}-notifications-dlq.fifo" NOTIF_DLQ_ARN

# Set redrive policies (main queues → DLQ after 3 receive attempts)
echo ""
echo "Configuring dead-letter queues..."

RELEASES_URL="https://sqs.${REGION}.amazonaws.com/${ACCOUNT_ID}/rrc-${ENV}-releases.fifo"
NOTIF_URL="https://sqs.${REGION}.amazonaws.com/${ACCOUNT_ID}/rrc-${ENV}-notifications.fifo"

aws sqs set-queue-attributes \
  --queue-url "$RELEASES_URL" \
  --attributes "{\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"${RELEASES_DLQ_ARN}\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"}" \
  --region "$REGION"

aws sqs set-queue-attributes \
  --queue-url "$NOTIF_URL" \
  --attributes "{\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"${NOTIF_DLQ_ARN}\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"}" \
  --region "$REGION"

echo "Dead-letter queues configured."

# ── S3 Object Lock bucket ─────────────────────────────────────────────────────

BUCKET_NAME="rrc-${ENV}-audit-worm"
echo ""
echo "Creating S3 Object Lock bucket: $BUCKET_NAME"

# Object Lock must be enabled at creation time
aws s3api create-bucket \
  --bucket "$BUCKET_NAME" \
  --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION" \
  --object-lock-enabled-for-bucket 2>/dev/null || echo "  (bucket already exists — skipping)"

# Enable versioning (required for Object Lock)
aws s3api put-bucket-versioning \
  --bucket "$BUCKET_NAME" \
  --versioning-configuration Status=Enabled

# Set Object Lock default retention: COMPLIANCE mode, 7 years (FCA requirement)
aws s3api put-object-lock-configuration \
  --bucket "$BUCKET_NAME" \
  --object-lock-configuration '{
    "ObjectLockEnabled": "Enabled",
    "Rule": {
      "DefaultRetention": {
        "Mode":  "COMPLIANCE",
        "Years": 7
      }
    }
  }'

# Block all public access
aws s3api put-public-access-block \
  --bucket "$BUCKET_NAME" \
  --public-access-block-configuration '{
    "BlockPublicAcls":       true,
    "IgnorePublicAcls":      true,
    "BlockPublicPolicy":     true,
    "RestrictPublicBuckets": true
  }'

echo "S3 bucket configured with 7-year COMPLIANCE retention."

# ── IAM policy for application user ─────────────────────────────────────────

POLICY_NAME="rrc-${ENV}-app-policy"
echo ""
echo "Creating IAM policy: $POLICY_NAME"

POLICY_DOC=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SQSAccess",
      "Effect": "Allow",
      "Action": [
        "sqs:SendMessage",
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
        "sqs:GetQueueUrl"
      ],
      "Resource": [
        "arn:aws:sqs:${REGION}:${ACCOUNT_ID}:rrc-${ENV}-*.fifo"
      ]
    },
    {
      "Sid": "S3AuditWrite",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::${BUCKET_NAME}/*"
    }
  ]
}
EOF
)

aws iam create-policy \
  --policy-name "$POLICY_NAME" \
  --policy-document "$POLICY_DOC" \
  --description "Minimum permissions for RRC application services" 2>/dev/null \
  || echo "  (policy already exists — skipping)"

echo ""
echo "=== AWS Provisioning Complete ==="
echo ""
echo "Add these to your production .env / Railway variables:"
echo ""
echo "  SQS_QUEUE_URL_RELEASES=https://sqs.${REGION}.amazonaws.com/${ACCOUNT_ID}/rrc-${ENV}-releases.fifo"
echo "  SQS_QUEUE_URL_NOTIFICATIONS=https://sqs.${REGION}.amazonaws.com/${ACCOUNT_ID}/rrc-${ENV}-notifications.fifo"
echo "  S3_AUDIT_BUCKET=${BUCKET_NAME}"
echo "  AWS_REGION=${REGION}"
echo ""
echo "Attach IAM policy 'rrc-${ENV}-app-policy' to your application's IAM user/role."
