import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { config } from '../config/config';

/** Adapter: send(to, subject, html, text). Google Workspace = SMTP relay config (smtp-relay.gmail.com:587) or swap this class for a Gmail API sender. */
@Injectable()
export class MailService {
  private transport = nodemailer.createTransport({
    host: config.mail.host, port: config.mail.port, secure: config.mail.secure,
    auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
  });

  send(to: string, subject: string, html: string, text: string) {
    return this.transport.sendMail({ from: config.mail.from, to, subject, html, text });
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Versioned e-mail templates (spec section 12): one action button and a plain text fallback. */
export const EMAIL_TEMPLATES: Record<string, { version: number; button: string; body: string }> = {
  'account.invite': { version: 1, button: 'Set up your account', body: 'Hello {{signer_name}}, an account was created for you on the AfS-Rwanda procurement system. Use the button to choose a password.' },
  'account.reset': { version: 1, button: 'Choose a new password', body: 'Hello {{signer_name}}, use the button to choose a new password.' },
  'sign_requested': { version: 1, button: 'Review and sign', body: 'Hello {{signer_name}}, {{document_title}} (request {{request_no}}) is waiting for your signature.' },
  'external_sign': { version: 1, button: 'Review and sign', body: 'Hello {{signer_name}}, AfS-Rwanda asks you to sign {{document_title}}. This link works once and expires.' },
  'returned': { version: 1, button: 'Open the document', body: '{{document_title}} (request {{request_no}}) was returned. Reason: {{reason}}' },
  'completed': { version: 1, button: 'Open the document', body: '{{document_title}} (request {{request_no}}) is fully signed.' },
  'followup': { version: 1, button: 'Open the memo', body: 'Hello {{signer_name}}, you were assigned an action on {{document_title}}: {{action}} (due {{due_date}}).' },
  'reminder': { version: 1, button: 'Review and sign', body: 'Reminder: {{document_title}} (request {{request_no}}) still waits for your signature.' },
  'expiry': { version: 1, button: 'Open the case', body: 'Heads up: {{reason}} for request {{request_no}}.' },
};

export function renderEmail(kind: string, subject: string, vars: Record<string, any>) {
  const t = EMAIL_TEMPLATES[kind] ?? { version: 1, button: 'Open', body: subject };
  const fill = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k] ?? ''));
  const body = fill(t.body);
  const link = String(vars.link ?? config.appUrl);
  return {
    html: `<div style="font-family:sans-serif;max-width:560px"><p>${esc(body)}</p><p><a href="${esc(link)}" style="background:#0b6b3a;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${esc(t.button)}</a></p><p style="color:#666;font-size:12px">AfS-Rwanda procurement system</p></div>`,
    text: `${body}\n\n${t.button}: ${link}\n`,
  };
}
