import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config/config';

export const QUEUE_NAME = 'afs';
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

  async add(name: string, data: Record<string, any>, opts: { jobId?: string; delay?: number } = {}) {
    try {
      await this.queue.add(name, data, opts);
    } catch (e: any) {
      this.log.error(`could not enqueue ${name}: ${e.message}`);
    }
  }

  async onModuleDestroy() {
    await this.queue.close();
    this.connection.disconnect();
  }
}
