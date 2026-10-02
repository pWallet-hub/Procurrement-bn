import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { AppModule } from './app.module';
import { Db } from './db/db.service';
import { QUEUE_NAME, QueueService, redisConnection } from './notifications/queue.service';
import { MailService, renderEmail } from './notifications/mail.service';
import { PdfService } from './pdf/pdf.service';
import { NotificationsService } from './notifications/notifications.service';
import { AuditService } from './audit/audit.service';
import { config } from './config/config';
import { runMigrations } from './db/migrate';

/** Background worker: e-mail, PDF rendering, reminders, expiry warnings, cleanup, audit checkpoints (spec section 12). */
async function main() {
  await runMigrations();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
  const log = new Logger('Worker');
  const db = app.get(Db), mail = app.get(MailService), pdf = app.get(PdfService), notify = app.get(NotificationsService), audit = app.get(AuditService), queue = app.get(QueueService);

  const handlers: Record<string, (job: Job) => Promise<unknown>> = {
    async email(job) {
      const n = await db.one('SELECT * FROM notifications WHERE id = $1', [job.data.notificationId]);
      if (!n) throw new Error('notification not found yet, will retry');
      if (!n.email) { await db.query("UPDATE notifications SET status = 'failed', error = 'no e-mail address' WHERE id = $1", [n.id]); return; }
      const { subject, vars } = n.payload;
      const { html, text } = renderEmail(n.kind, subject, vars ?? {});
      try {
        await mail.send(n.email, subject, html, text);
        await db.query("UPDATE notifications SET status = 'sent', sent_at = now(), error = NULL WHERE id = $1", [n.id]);
      } catch (e: any) {
        await db.query("UPDATE notifications SET status = 'failed', error = $2 WHERE id = $1", [n.id, e.message]);
        throw e; // BullMQ retries with backoff, then keeps it in the failed set (dead letter)
      }
    },
    'pdf.render': (job) => pdf.renderAndStore(job.data.documentId),
    'pdf.case_file': (job) => pdf.buildCaseFile(job.data.caseId),

    /** daily: remind signers whose slot has waited longer than REMINDER_DAYS */
    async reminder() {
      const rows = (await db.query(
        `SELECT s.id, s.assigned_user_id, s.role_code, d.id AS doc_id, t.title, c.request_no
         FROM signature_slots s JOIN documents d ON d.id = s.document_id JOIN form_templates t ON t.id = d.template_id LEFT JOIN cases c ON c.id = d.case_id
         WHERE s.status = 'pending' AND s.voided_at IS NULL AND s.external_email IS NULL AND d.state = 'in_signing' AND d.updated_at < now() - ($1 || ' days')::interval`, [String(config.reminderDays)])).rows;
      for (const r of rows) {
        const people = r.assigned_user_id ? [{ id: r.assigned_user_id }] : (await db.query('SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id WHERE ur.role_code = $1 AND u.active', [r.role_code])).rows;
        for (const p of people) await notify.send({ userId: p.id, kind: 'reminder', subject: `Reminder: ${r.title}`, vars: { document_title: r.title, request_no: r.request_no ?? '' }, path: `/documents/${r.doc_id}` });
      }
      log.log(`reminders: ${rows.length} pending slots`);
    },

    /** daily: warn the requester about delivery dates near (3 days) on open cases */
    async expiry() {
      const rows = (await db.query(
        `SELECT c.id, c.request_no, c.requested_by, d.data->>'expected_delivery_completion' AS due
         FROM cases c JOIN documents d ON d.case_id = c.id AND d.doc_type = 'PA-04' AND d.state <> 'cancelled'
         WHERE c.status = 'open' AND (d.data->>'expected_delivery_completion') IS NOT NULL
           AND (d.data->>'expected_delivery_completion')::date BETWEEN current_date AND current_date + 3`)).rows;
      for (const r of rows) await notify.send({ userId: r.requested_by, kind: 'expiry', subject: `Delivery date near: ${r.request_no}`, vars: { request_no: r.request_no, reason: `expected delivery on ${r.due}` }, path: `/cases/${r.id}` });
    },

    async 'token.cleanup'() {
      await db.query("DELETE FROM signing_tokens WHERE expires_at < now() - interval '7 days'");
      await db.query("DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days'");
      await db.query("DELETE FROM user_tokens WHERE expires_at < now() - interval '30 days'");
      await db.query("DELETE FROM idempotency_keys WHERE created_at < now() - interval '2 days'");
    },

    /** nightly: record the chain head; verify the chain end to end */
    async 'audit.checkpoint'() {
      const chain = await audit.verifyChain();
      const last = await db.one('SELECT id, event_hash FROM audit_events ORDER BY id DESC LIMIT 1');
      if (last) await db.query('INSERT INTO audit_checkpoints (last_event_id, event_hash) VALUES ($1,$2)', [last.id, last.event_hash]);
      if (!chain.ok) log.error(`AUDIT CHAIN BROKEN at event ${chain.failing_id}`);
    },
  };

  const worker = new Worker(QUEUE_NAME, async (job) => {
    const h = handlers[job.name];
    if (!h) throw new Error(`no handler for ${job.name}`);
    return h(job);
  }, { connection: redisConnection(), concurrency: 5 });
  worker.on('failed', (job, err) => log.error(`job ${job?.name} (${job?.id}) failed: ${err.message}`));
  worker.on('completed', (job) => log.debug?.(`job ${job.name} done`));

  // schedules (idempotent upserts)
  const q = queue.queue;
  await q.upsertJobScheduler('daily-reminder', { pattern: '0 7 * * *' }, { name: 'reminder' });
  await q.upsertJobScheduler('daily-expiry', { pattern: '15 7 * * *' }, { name: 'expiry' });
  await q.upsertJobScheduler('daily-token-cleanup', { pattern: '30 2 * * *' }, { name: 'token.cleanup' });
  await q.upsertJobScheduler('nightly-audit-checkpoint', { pattern: '0 2 * * *' }, { name: 'audit.checkpoint' });
  log.log('worker ready');

  const stop = async () => { await worker.close(); await app.close(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
main().catch((e) => { console.error(e); process.exit(1); });
