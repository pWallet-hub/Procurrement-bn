import { Controller, Get, Param, Post } from '@nestjs/common';
import { AuthUser, CurrentUser, Perm } from '../common/auth';
import { Db } from '../db/db.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../attachments/storage.service';
import { QueueService } from '../notifications/queue.service';
import { NotificationsService } from '../notifications/notifications.service';
import { badRequest, notFound } from '../common/errors';
import { config } from '../config/config';

/**
 * Administration > System health and Overview: is every part of the system working, and what needs attention.
 * Every check has its own time limit, so one service that hangs (Redis, storage, AFS) never blocks the page.
 */

export type CheckStatus = 'ok' | 'warning' | 'error' | 'off';
export interface Check {
  key: string;
  label: string;
  status: CheckStatus;
  /** One sentence for the admin. */
  summary: string;
  /** What to do about it, when something is wrong. */
  fix?: string;
  /** Small facts shown under the check (counts, addresses, times). */
  facts?: Record<string, string | number | null>;
  ms?: number;
}

const CHECK_TIMEOUT_MS = 5000;

async function timed(key: string, label: string, run: () => Promise<Omit<Check, 'key' | 'label' | 'ms'>>): Promise<Check> {
  const t0 = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer within ${CHECK_TIMEOUT_MS / 1000} s`)), CHECK_TIMEOUT_MS); });
    const r = await Promise.race([run(), timeout]);
    return { key, label, ...r, ms: Date.now() - t0 };
  } catch (e: any) {
    return { key, label, status: 'error', summary: `Check failed: ${e?.message ?? e}`, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

@Controller('admin/system') @Perm('admin.manage')
export class SystemController {
  constructor(
    private db: Db,
    private audit: AuditService,
    private storage: StorageService,
    private queue: QueueService,
    private notify: NotificationsService,
  ) {}

  // ---------------------------------------------------------------- health

  @Get('health')
  async health() {
    const checks = await Promise.all([
      this.checkDatabase(), this.checkStorage(), this.checkQueue(), this.checkWorker(),
      this.checkEmail(), this.checkPdfs(), this.checkSignIn(), this.checkAudit(),
    ]);
    const overall: CheckStatus = checks.some((c) => c.status === 'error') ? 'error' : checks.some((c) => c.status === 'warning') ? 'warning' : 'ok';
    return { status: overall, checked_at: new Date().toISOString(), environment: config.nodeEnv, app_url: config.appUrl, checks };
  }

  private checkDatabase() {
    return timed('database', 'Database', async () => {
      await this.db.query('SELECT 1');
      const r = await this.db.one<{ users: number; cases: number; documents: number; size: string }>(
        `SELECT (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM cases)::int AS cases,
                (SELECT count(*) FROM documents)::int AS documents, pg_size_pretty(pg_database_size(current_database())) AS size`);
      return { status: 'ok', summary: 'Connected. Records can be read and saved.', facts: { Users: r!.users, Cases: r!.cases, Documents: r!.documents, Size: r!.size } };
    });
  }

  private checkStorage() {
    return timed('storage', 'File storage', async () => {
      try {
        const s = await this.storage.check();
        return { status: 'ok', summary: 'Files (attachments, signatures, PDFs) can be saved and read.', facts: { Type: s.driver === 's3' ? 'S3 object store' : 'Local folder', Location: s.location } };
      } catch (e: any) {
        return {
          status: 'error', summary: `Files cannot be saved: ${e?.message ?? e}`,
          fix: 'Check that the storage service is running and that S3_ENDPOINT, S3_BUCKET and the S3 keys are correct. Uploads, signatures and PDFs fail until this works.',
        };
      }
    });
  }

  private checkQueue() {
    return timed('queue', 'Background jobs queue', async () => {
      const counts = await this.queue.queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
      const failed = counts.failed ?? 0;
      const facts = { Waiting: counts.waiting ?? 0, Running: counts.active ?? 0, Scheduled: counts.delayed ?? 0, Failed: failed };
      if ((counts.waiting ?? 0) > 200) {
        return { status: 'warning', summary: `${counts.waiting} jobs are waiting. Emails and PDFs will be late.`, fix: 'Check that the worker is running (see "Background worker") and has enough CPU.', facts };
      }
      return failed > 0
        ? { status: 'warning', summary: `Connected to Redis. ${failed} job(s) failed after all retries.`, fix: 'Failed jobs are usually emails that could not be sent; see "Email" below.', facts }
        : { status: 'ok', summary: 'Connected to Redis. Jobs are flowing.', facts };
    });
  }

  private checkWorker() {
    return timed('worker', 'Background worker', async () => {
      let workers: number | null = null;
      try { workers = await this.queue.queue.getWorkersCount(); } catch { /* some Redis hosts block CLIENT LIST */ }
      const schedulers = await this.queue.queue.getJobSchedulers().catch(() => []);
      const next = schedulers.map((s: any) => s.next).filter(Boolean).sort((a: number, b: number) => a - b)[0];
      const facts = { 'Workers connected': workers, 'Scheduled tasks': schedulers.length, 'Next scheduled run': next ? new Date(next).toISOString() : null };
      if (workers === 0) {
        return { status: 'error', summary: 'No worker is running. Emails, PDFs and daily reminders are not being processed.', fix: 'Start the "worker" service (docker compose up -d worker) and check its logs.', facts };
      }
      if (schedulers.length === 0) {
        return { status: 'warning', summary: 'No scheduled tasks are registered (reminders, cleanup, audit checkpoints).', fix: 'Restart the worker: it registers the schedules when it starts.', facts };
      }
      return { status: 'ok', summary: workers == null ? 'Scheduled tasks are registered (worker count not available on this Redis).' : `${workers} worker(s) running; daily reminders and cleanup are scheduled.`, facts };
    });
  }

  private checkEmail() {
    return timed('email', 'Email', async () => {
      const r = await this.db.one<{ sent: number; failed: number; stuck: number; last_sent: string | null; last_error: string | null }>(
        `SELECT count(*) FILTER (WHERE status = 'sent' AND created_at > now() - interval '7 days')::int AS sent,
                count(*) FILTER (WHERE status = 'failed' AND created_at > now() - interval '7 days')::int AS failed,
                count(*) FILTER (WHERE status = 'queued' AND created_at < now() - interval '15 minutes')::int AS stuck,
                max(sent_at) AS last_sent,
                (SELECT error FROM notifications WHERE channel = 'email' AND status = 'failed' ORDER BY created_at DESC LIMIT 1) AS last_error
         FROM notifications WHERE channel = 'email'`);
      const facts = { 'Sent (7 days)': r!.sent, 'Failed (7 days)': r!.failed, 'Waiting > 15 min': r!.stuck, 'Last sent': r!.last_sent, From: config.mail.from || null };
      if (!config.mail.resendApiKey || !config.mail.from) {
        return { status: 'error', summary: 'Email is not configured.', fix: 'Set RESEND_API_KEY and MAIL_FROM. Invitations, signing requests and reminders are not delivered until then.', facts };
      }
      if (r!.stuck > 0) {
        return { status: 'error', summary: `${r!.stuck} email(s) have been waiting more than 15 minutes.`, fix: 'The worker is not sending. Check "Background worker" and the worker logs.', facts };
      }
      if (r!.failed > 0 && r!.sent === 0) {
        return { status: 'error', summary: `Emails are failing: ${r!.last_error ?? 'unknown error'}`, fix: 'Check RESEND_API_KEY and that the MAIL_FROM domain is verified in Resend, then use "Retry failed emails" on the Overview.', facts };
      }
      if (r!.failed > 0) {
        return { status: 'warning', summary: `${r!.failed} email(s) failed this week. Last error: ${r!.last_error ?? 'unknown'}`, fix: 'Usually a wrong or missing address. Fix the address, then use "Retry failed emails" on the Overview.', facts };
      }
      return { status: 'ok', summary: r!.sent ? 'Emails are being delivered.' : 'Configured. No emails sent this week yet.', facts };
    });
  }

  private checkPdfs() {
    return timed('pdf', 'Signed PDFs', async () => {
      const r = await this.db.one<{ missing: number; signed: number }>(
        `SELECT count(*) FILTER (WHERE pdf_object_key IS NULL AND updated_at < now() - interval '10 minutes')::int AS missing,
                count(*)::int AS signed
         FROM documents WHERE state IN ('signed', 'archived')`);
      const facts = { 'Signed documents': r!.signed, 'Without PDF': r!.missing };
      return r!.missing > 0
        ? { status: 'warning', summary: `${r!.missing} signed document(s) have no PDF yet.`, fix: 'The worker retries every 5 minutes. If the number does not go down, check the worker logs and file storage.', facts }
        : { status: 'ok', summary: 'Every signed document has its PDF.', facts };
    });
  }

  private checkSignIn() {
    return timed('signin', 'Sign-in', async () => {
      const facts: Record<string, string | number | null> = { 'Password sign-in': config.passwordLogin ? 'On' : 'Off', 'AFS single sign-on': config.sso ? 'On' : 'Off' };
      if (!config.sso) {
        return config.passwordLogin
          ? { status: 'ok', summary: 'People sign in with a password. AFS single sign-on is off.', facts }
          : { status: 'error', summary: 'Both password sign-in and AFS sign-on are off: nobody can sign in.', fix: 'Set AFS_SSO_ENABLED=true (with the AFS_* settings) or PASSWORD_LOGIN=true.', facts };
      }
      facts.Issuer = config.sso.issuer;
      try {
        const res = await fetch(`${config.sso.internalIssuer.replace(/\/$/, '')}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return { status: 'ok', summary: 'AFS single sign-on is reachable.', facts };
      } catch (e: any) {
        return {
          status: 'error', summary: `AFS sign-in server cannot be reached (${e?.message ?? e}). People cannot sign in with AFS.`,
          fix: 'Check that AFS Command Center / Keycloak is running and that AFS_OIDC_INTERNAL_ISSUER (or AFS_OIDC_ISSUER) is reachable from the API.', facts,
        };
      }
    });
  }

  private checkAudit() {
    return timed('audit', 'Audit trail', async () => {
      const r = await this.db.one<{ events: number; first_event: string | null; last_checkpoint: string | null }>(
        `SELECT (SELECT count(*) FROM audit_events)::int AS events, (SELECT min(at) FROM audit_events) AS first_event,
                (SELECT max(at) FROM audit_checkpoints) AS last_checkpoint`);
      const facts = { Events: r!.events, 'Last nightly check': r!.last_checkpoint ?? 'Not yet (runs at 02:00)' };
      const olderThan2Days = (t: string | null) => !!t && Date.now() - new Date(t).getTime() > 2 * 86400_000;
      // A new installation has had no night yet: only warn once the system is more than 2 days old.
      if (olderThan2Days(r!.first_event) && (!r!.last_checkpoint || olderThan2Days(r!.last_checkpoint))) {
        return { status: 'warning', summary: 'The nightly audit check has not run in the last 2 days.', fix: 'It runs at 02:00 in the worker. Check that the worker is running. You can also run "Verify audit trail" now.', facts };
      }
      return { status: 'ok', summary: 'Recording. Entries cannot be changed or deleted.', facts };
    });
  }

  /** Recomputes the whole audit hash chain now (the worker also does this nightly). */
  @Post('audit/verify')
  async verifyAudit(@CurrentUser() admin: AuthUser) {
    const r = await this.audit.verifyChain();
    await this.audit.log({ actorId: admin.id, action: 'admin.audit_verified', objectType: 'system', objectId: null, detail: r });
    return r;
  }

  // ---------------------------------------------------------------- overview

  @Get('overview')
  async overview() {
    const [people, setup, waiting, overdue, drafts, returned, emails] = await Promise.all([
      this.db.one(
        `SELECT count(*) FILTER (WHERE active)::int AS active,
                count(*) FILTER (WHERE NOT active)::int AS inactive,
                count(*) FILTER (WHERE active AND password_hash IS NULL AND external_id IS NULL)::int AS invite_pending,
                count(*) FILTER (WHERE active AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id))::int AS no_roles,
                count(*) FILTER (WHERE active AND signature_image_key IS NULL)::int AS no_signature
         FROM users u`),
      this.db.one(
        `SELECT (SELECT count(*) FROM departments)::int AS departments,
                (SELECT count(*) FROM budget_lines WHERE active)::int AS budget_lines,
                (SELECT count(*) FROM suppliers WHERE active IS DISTINCT FROM false)::int AS suppliers`),
      this.db.query(
        `SELECT s.id AS slot_id, s.label, s.role_code, au.full_name AS assigned_to, d.id AS document_id, d.doc_type, t.title,
                c.request_no, d.updated_at AS waiting_since, count(*) OVER ()::int AS total
         FROM signature_slots s JOIN documents d ON d.id = s.document_id JOIN form_templates t ON t.id = d.template_id
         LEFT JOIN cases c ON c.id = d.case_id LEFT JOIN users au ON au.id = s.assigned_user_id
         WHERE s.status = 'pending' AND s.voided_at IS NULL AND d.state = 'in_signing'
         ORDER BY d.updated_at LIMIT 25`),
      this.db.query(
        `SELECT c.id, c.request_no, c.project, c.required_by, c.current_stage, u.full_name AS requested_by, count(*) OVER ()::int AS total
         FROM cases c JOIN users u ON u.id = c.requested_by
         WHERE c.status = 'open' AND c.required_by < current_date ORDER BY c.required_by LIMIT 25`),
      this.db.query(
        `SELECT d.id, d.doc_type, t.title, c.request_no, u.full_name AS created_by, d.updated_at, count(*) OVER ()::int AS total
         FROM documents d JOIN form_templates t ON t.id = d.template_id JOIN users u ON u.id = d.created_by LEFT JOIN cases c ON c.id = d.case_id
         WHERE d.state = 'draft' AND d.updated_at < now() - interval '7 days' ORDER BY d.updated_at LIMIT 25`),
      this.db.query(
        `SELECT d.id, d.doc_type, t.title, c.request_no, d.returned_reason, d.updated_at, count(*) OVER ()::int AS total
         FROM documents d JOIN form_templates t ON t.id = d.template_id LEFT JOIN cases c ON c.id = d.case_id
         WHERE d.state = 'returned' ORDER BY d.updated_at LIMIT 25`),
      this.db.query(
        `SELECT n.id, n.kind, n.email, n.error, n.created_at, u.full_name, count(*) OVER ()::int AS total
         FROM notifications n LEFT JOIN users u ON u.id = n.user_id
         WHERE n.channel = 'email' AND n.status = 'failed' AND n.created_at > now() - interval '7 days'
         ORDER BY n.created_at DESC LIMIT 25`),
    ]);
    const list = (r: { rows: any[] }) => ({ total: r.rows[0]?.total ?? 0, items: r.rows.map(({ total: _t, ...rest }) => rest) });
    return {
      people: { ...people, password_login: config.passwordLogin },
      setup,
      waiting_signatures: list(waiting),
      overdue_cases: list(overdue),
      stale_drafts: list(drafts),
      returned_documents: list(returned),
      failed_emails: list(emails),
      reminder_days: config.reminderDays,
    };
  }

  /** Sends the signer(s) of a pending slot a reminder now, instead of waiting for the daily reminder. */
  @Post('slots/:id/remind')
  async remind(@CurrentUser() admin: AuthUser, @Param('id') id: string) {
    const r = await this.db.one(
      `SELECT s.id, s.assigned_user_id, s.role_code, d.id AS doc_id, t.title, c.request_no
       FROM signature_slots s JOIN documents d ON d.id = s.document_id JOIN form_templates t ON t.id = d.template_id LEFT JOIN cases c ON c.id = d.case_id
       WHERE s.id = $1 AND s.status = 'pending' AND s.voided_at IS NULL AND d.state = 'in_signing'`, [id]);
    if (!r) throw notFound('pending signature');
    const people = r.assigned_user_id
      ? [{ id: r.assigned_user_id }]
      : (await this.db.query('SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id WHERE ur.role_code = $1 AND u.active', [r.role_code])).rows;
    if (!people.length) throw badRequest('no_signer', 'Nobody holds this role yet. Give someone the role in Users, or assign a signer on the document.');
    for (const p of people) {
      await this.notify.send({ userId: p.id, kind: 'reminder', subject: `Reminder: ${r.title}`, vars: { document_title: r.title, request_no: r.request_no ?? '' }, path: `/documents/${r.doc_id}` });
    }
    await this.audit.log({ actorId: admin.id, action: 'admin.reminder_sent', objectType: 'document', objectId: r.doc_id, detail: { slot_id: id, recipients: people.length } });
    return { sent: people.length };
  }

  /** Puts this week's failed emails back in the queue (after fixing the address or the email settings). */
  @Post('notifications/retry-failed')
  async retryFailedEmails(@CurrentUser() admin: AuthUser) {
    const rows = (await this.db.query(
      `UPDATE notifications SET status = 'queued', error = NULL
       WHERE channel = 'email' AND status = 'failed' AND created_at > now() - interval '7 days'
         AND (email IS NOT NULL OR user_id IS NOT NULL)
       RETURNING id, user_id, email`)).rows;
    for (const n of rows) {
      // the address may have been fixed since: take the user's current one
      if (n.user_id) await this.db.query('UPDATE notifications SET email = (SELECT email FROM users WHERE id = $2) WHERE id = $1', [n.id, n.user_id]);
      // a new job id: the old one is still in the failed set and BullMQ would ignore a duplicate
      await this.queue.add('email', { notificationId: n.id }, { jobId: `email-${n.id}-retry-${Date.now()}` }).catch(() => undefined);
    }
    await this.audit.log({ actorId: admin.id, action: 'admin.emails_retried', objectType: 'system', objectId: null, detail: { count: rows.length } });
    return { retried: rows.length };
  }
}
