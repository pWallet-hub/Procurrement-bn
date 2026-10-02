import { Injectable } from '@nestjs/common';
import { Db, Queryable } from '../db/db.service';
import { QueueService } from './queue.service';
import { config } from '../config/config';

export interface SendInput {
  userId?: string | null; email?: string | null; kind: string; subject: string;
  vars?: Record<string, any>; inApp?: boolean; path?: string;
}

@Injectable()
export class NotificationsService {
  constructor(private db: Db, private queue: QueueService) {}

  /**
   * Record a notification and queue the e-mail.
   * Call with the transaction client `q` to keep it atomic with the state change; use flush() after commit to enqueue.
   */
  async send(i: SendInput, q: Queryable = this.db): Promise<string> {
    let email = i.email ?? null;
    if (!email && i.userId) email = (await q.query('SELECT email FROM users WHERE id = $1', [i.userId])).rows[0]?.email ?? null;
    const vars = { ...(i.vars ?? {}), link: i.vars?.link ?? `${config.appUrl}${i.path ?? '/'}` };
    const r = await q.query(
      `INSERT INTO notifications (user_id, email, kind, payload, channel, status) VALUES ($1,$2,$3,$4,'email','queued') RETURNING id`,
      [i.userId ?? null, email, i.kind, JSON.stringify({ subject: i.subject, vars, in_app: i.inApp !== false })],
    );
    const id = r.rows[0].id as string;
    if (q === (this.db as Queryable)) await this.queue.add('email', { notificationId: id }, { jobId: `email-${id}` });
    else this.pending.push(id);
    return id;
  }

  private pending: string[] = [];
  /** enqueue e-mails recorded inside a transaction once it has committed */
  async flush() {
    const ids = this.pending.splice(0);
    for (const id of ids) await this.queue.add('email', { notificationId: id }, { jobId: `email-${id}` });
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
