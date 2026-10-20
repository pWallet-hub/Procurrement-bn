import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config/config';

export const QUEUE_NAME = 'afs';
const ADD_TIMEOUT_MS = 5000;
export const redisConnection = () => new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

/** Producer side of the job queue (email, pdf). The worker process consumes it (src/worker.ts). */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private log = new Logger('Queue');
  private connection = redisConnection();
  readonly queue = new Queue(QUEUE_NAME, {
    connection: this.connection,
    defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 1000, removeOnFail: false },
  });

  constructor() {
    this.connection.on('error', (e) => this.log.warn(`redis: ${e.message}`));
  }

  /** Rejects when Redis does not answer in time; the connection retries without limit, so an outage would otherwise hang the request. */
  async add(name: string, data: Record<string, any>, opts: { jobId?: string; delay?: number } = {}) {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`queue unavailable (no answer from Redis within ${ADD_TIMEOUT_MS} ms)`)), ADD_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.queue.add(name, data, opts), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async onModuleDestroy() {
    await this.queue.close();
    this.connection.disconnect();
  }
}
