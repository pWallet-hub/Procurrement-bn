import { Injectable, Logger } from '@nestjs/common';
import { Db, Queryable } from '../db/db.service';
import { QueueService } from './queue.service';
import { config } from '../config/config';

export interface SendInput {
  userId?: string | null; email?: string | null; kind: string; subject: string;
  vars?: Record<string, any>; inApp?: boolean; path?: string;
}

@Injectable()
export class NotificationsService {
  private log = new Logger('Notifications');
  constructor(private db: Db, private queue: QueueService) {}

  /**
   * Record a notification and queue the e-mail.
   * Call with the transaction client `q` to keep it atomic with the state change; use flush() after commit to enqueue.
   */
  async send(i: SendInput, q: Queryable = this.db): Promise<string> {
    let email = i.email ?? null;
    if (!email && i.userId) email = (await q.query('SELECT email FROM users WHERE id = $1', [i.userId])).rows[0]?.email ?? null;
    const vars = { ...(i.vars ?? {}), link: i.vars?.link ?? `${config.appUrl}${i.path ?? '/'}` };
    const docId = /^\/documents\/([0-9a-f-]{36})/.exec(i.path ?? '')?.[1] ?? null;
    const r = await q.query(
      `INSERT INTO notifications (user_id, email, kind, payload, channel, status) VALUES ($1,$2,$3,$4,'email','queued') RETURNING id`,
      [i.userId ?? null, email, i.kind, JSON.stringify({ subject: i.subject, title: i.subject, message: i.subject, document_id: docId, path: i.path ?? null, vars, in_app: i.inApp !== false })],
    );
    const id = r.rows[0].id as string;
    if (q === (this.db as Queryable)) await this.enqueue(id);
    else this.pending.push(id);
    return id;
  }

  private pending: string[] = [];
  /** enqueue e-mails recorded inside a transaction once it has committed */
  async flush() {
    for (const id of this.pending.splice(0)) await this.enqueue(id);
  }

  /** The row is already stored as 'queued'; if Redis is unavailable the worker's email.requeue job picks it up, so never fail the request. */
  private async enqueue(id: string) {
    try {
      await this.queue.add('email', { notificationId: id }, { jobId: `email-${id}` });
    } catch (e: any) {
      this.log.warn(`could not enqueue email ${id} (will be requeued): ${e.message}`);
    }
  }

  list(userId: string) {
    return this.db.query(
      `SELECT id, kind, payload, status, created_at, read_at FROM notifications
       WHERE user_id = $1 AND COALESCE((payload->>'in_app')::boolean, true) ORDER BY created_at DESC LIMIT 100`, [userId]).then((r) => ({ items: r.rows }));
  }
  async markRead(userId: string, id: string) {
    await this.db.query('UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2', [id, userId]);
    return { ok: true };
  }
}
