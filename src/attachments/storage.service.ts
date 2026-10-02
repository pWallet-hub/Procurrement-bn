import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { promises as fs } from 'fs';
import { dirname, join, normalize } from 'path';
import { config } from '../config/config';

/** Storage interface: local encrypted volume or any S3 compatible store (SeaweedFS in Docker). */
@Injectable()
export class StorageService implements OnModuleInit {
  private log = new Logger('Storage');
  private s3 = config.storage.driver === 's3'
    ? new S3Client({ endpoint: config.storage.endpoint, region: config.storage.region, forcePathStyle: true, credentials: { accessKeyId: config.storage.accessKey, secretAccessKey: config.storage.secretKey } })
    : null;

  async onModuleInit() {
    if (!this.s3) { await fs.mkdir(config.storage.localDir, { recursive: true }); return; }
    for (let i = 0; i < 10; i++) {
      try {
        await this.s3.send(new HeadBucketCommand({ Bucket: config.storage.bucket }));
        return;
      } catch (e: any) {
        if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound') {
          await this.s3.send(new CreateBucketCommand({ Bucket: config.storage.bucket }));
          this.log.log(`created bucket ${config.storage.bucket}`);
          return;
        }
        this.log.warn(`waiting for object store: ${e?.message}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  async put(key: string, body: Buffer, mime = 'application/octet-stream'): Promise<void> {
    if (this.s3) { await this.s3.send(new PutObjectCommand({ Bucket: config.storage.bucket, Key: key, Body: body, ContentType: mime })); return; }
    const p = this.localPath(key);
    await fs.mkdir(dirname(p), { recursive: true });
    await fs.writeFile(p, body);
  }

  async get(key: string): Promise<Buffer> {
    if (this.s3) {
      const r = await this.s3.send(new GetObjectCommand({ Bucket: config.storage.bucket, Key: key }));
      return Buffer.from(await r.Body!.transformToByteArray());
    }
    return fs.readFile(this.localPath(key));
  }

  private localPath(key: string) {
    const safe = normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
    return join(config.storage.localDir, safe);
  }
}
