import { Body, Controller, Get, Logger, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ClientIp, Public } from '../common/auth';
import { badRequest } from '../common/errors';
import { config } from '../config/config';
import { SsoFailure } from './afs';
import { readCookie, safeNextPath, SSO_STATE, SsoService } from './sso.service';

const STATE_PATH = '/api/v1/auth/sso';
const log = new Logger('Sso');

/** Browser-facing sign-in routes. They are public because a person signs in through them. */
@Public()
@Controller('auth/sso')
export class SsoController {
  constructor(private sso: SsoService) {}

  @Get('config')
  settings() {
    return { enabled: this.sso.enabled };
  }

  @Get('login')
  login(@Query() q: any, @Res() res: Response) {
    if (!this.sso.enabled) return res.status(404).json({ error: { code: 'sso_disabled', message: 'Single sign-on is not enabled' } });
    const { url, cookie } = this.sso.start(safeNextPath(q.next), q.silent === '1');
    res.cookie(SSO_STATE.cookie, cookie, stateCookieOptions());
    return res.redirect(url);
  }

  /** Keycloak returns here. Every outcome ends on the portal: success hands over a one-time code, failure a short code. */
  @Get('callback')
  async callback(@Query() q: any, @Req() req: Request, @Res() res: Response, @ClientIp() ip: string | null) {
    const portal = config.appUrl;
    const saved = this.sso.readState(readCookie(req.headers.cookie, SSO_STATE.cookie));
    res.clearCookie(SSO_STATE.cookie, { path: STATE_PATH });
    try {
      const userId = await this.sso.finish(q, saved, ip);
      const code = await this.sso.issueCode(userId);
      return res.redirect(`${portal}/sso/complete?code=${code}&next=${encodeURIComponent(saved!.next)}`);
    } catch (e) {
      if (!(e instanceof SsoFailure)) log.error(e instanceof Error ? e.stack : String(e));
      const code = e instanceof SsoFailure ? e.code : 'unavailable';
      return res.redirect(`${portal}/login?sso_error=${code}`);
    }
  }

  /** The portal trades its one-time code for Procurement's own tokens. */
  @Post('exchange')
  exchange(@Body() b: any, @ClientIp() ip: string | null) {
    if (typeof b?.code !== 'string' || !b.code) throw badRequest('bad_request', 'Missing fields', { code: 'required' });
    return this.sso.exchange(b.code, ip);
  }
}

function stateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.appUrl.startsWith('https://'),
    path: STATE_PATH,
    maxAge: SSO_STATE.ttlSeconds * 1000,
  };
}
