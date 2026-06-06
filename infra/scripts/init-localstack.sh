#!/bin/bash
# LocalStack initialisation — runs inside the LocalStack container at startup.
# Creates SQS FIFO queues and S3 bucket for local development.
set -e

REGION="${DEFAULT_REGION:-eu-west-2}"
ENDPOINT="http://localhost:4566"

# Use awslocal if available, otherwise fall back to aws --endpoint-url
if command -v awslocal &>/dev/null; then
  AWS="awslocal"
else
  AWS="aws --endpoint-url=$ENDPOINT"
fi

export AWS_DEFAULT_REGION="$REGION"
export AWS_ACCESS_KEY_ID="test"
export AWS_SECRET_ACCESS_KEY="test"

echo "=== Initialising LocalStack resources (region: $REGION) ==="

create_queue() {
  local name="$1"
  echo "  Creating queue: $name"
  $AWS sqs create-queue \
    --queue-name "$name" \
    --attributes FifoQueue=true,ContentBasedDeduplication=false \
    --region "$REGION" 2>&1 || echo "  (queue $name may already exist)"
}

create_queue "rrc-releases.fifo"
create_queue "rrc-notifications.fifo"
create_queue "rrc-releases-dlq.fifo"
create_queue "rrc-notifications-dlq.fifo"

echo "SQS queues created."

# S3 bucket for audit storage
echo "  Creating S3 bucket: rrc-audit-worm"
$AWS s3api create-bucket \
  --bucket rrc-audit-worm \
  --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION" 2>&1 || echo "  (bucket may already exist)"

echo "=== LocalStack init complete ==="
