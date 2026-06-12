import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '../config.js';
import { logger } from '../logger.js';

/**
 * S3-compatible object storage (DigitalOcean Spaces) for recordings and
 * voicemail. Presigned URLs let the frontend download media directly without
 * proxying bytes through the API.
 */
export class S3Service {
  private readonly client: S3Client | null;
  private readonly bucket: string;

  constructor(cfg: AppConfig['s3']) {
    this.bucket = cfg.bucket;
    if (cfg.accessKey && cfg.secretKey) {
      this.client = new S3Client({
        region: cfg.region,
        endpoint: cfg.endpoint,
        forcePathStyle: cfg.forcePathStyle,
        credentials: {
          accessKeyId: cfg.accessKey,
          secretAccessKey: cfg.secretKey,
        },
      });
    } else {
      this.client = null;
      logger.warn('S3 credentials not set — object storage disabled');
    }
  }

  private require(): S3Client {
    if (!this.client) throw new Error('S3 not configured');
    return this.client;
  }

  async presignedGet(key: string, expiresIn = 900): Promise<string> {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.require(), cmd, { expiresIn });
  }

  async presignedPut(
    key: string,
    contentType = 'application/octet-stream',
    expiresIn = 900,
  ): Promise<string> {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.require(), cmd, { expiresIn });
  }

  async upload(
    key: string,
    body: Buffer | Uint8Array | string,
    contentType = 'application/octet-stream',
  ): Promise<void> {
    await this.require().send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.require().send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
