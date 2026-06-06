/**
 * Write an audit record to S3 Object Lock bucket (WORM — Write Once Read Many).
 * Key: audit/{tenant_id}/{release_id}/{timestamp}.json
 *
 * Failure is logged but DOES NOT fail the HTTP response — DB write is the source
 * of truth; S3 is a compliance backup layer.
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import logger from '../logger.js';

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'eu-west-2',
  endpoint: process.env.S3_ENDPOINT,               // MinIO in dev
  forcePathStyle: Boolean(process.env.S3_ENDPOINT), // required for MinIO
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID     || 'minioadmin',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'minioadmin',
  },
});

const BUCKET = process.env.S3_AUDIT_BUCKET || 'rrc-audit-worm';

/**
 * @param {object} record   Full audit_log row to persist
 */
export async function writeAuditWorm(record) {
  const key = `audit/${record.tenant_id}/${record.release_id}/${record.timestamp ?? new Date().toISOString()}.json`;

  try {
    await s3.send(new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         key,
      Body:        JSON.stringify(record, null, 2),
      ContentType: 'application/json',
    }));
    logger.info({ msg: 'audit_worm_written', key });
  } catch (err) {
    // Non-fatal — DB audit_log is the authoritative record
    logger.error({ msg: 'audit_worm_failed', key, error: err.message });
  }
}
