import { Body, Controller, Get, Post } from '@nestjs/common';
import { AuthUser, ClientIp, CurrentUser, Public, rateLimit } from '../common/auth';
import { badRequest } from '../common/errors';
import { AuthService } from './auth.service';

const need = (o: any, ...keys: string[]) => {
  const fields: Record<string, string> = {};
  for (const k of keys) if (o?.[k] === undefined || o?.[k] === '') fields[k] = 'required';
  if (Object.keys(fields).length) throw badRequest('bad_request', 'Missing fields', fields);
};

@Controller()
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public() @Post('auth/login')
  login(@Body() b: any, @ClientIp() ip: string | null) {
    need(b, 'email', 'password');
    rateLimit(`login:${ip}`, 30, 60_000);
    return this.auth.login(String(b.email).trim().toLowerCase(), b.password, ip);
  }
  @Public() @Post('auth/totp')
  totp(@Body() b: any, @ClientIp() ip: string | null) { need(b, 'challenge_token', 'code'); rateLimit(`totp:${ip}`, 20, 60_000); return this.auth.totp(b.challenge_token, String(b.code), ip); }
  @Public() @Post('auth/refresh')
  refresh(@Body() b: any) { need(b, 'refresh_token'); return this.auth.refresh(b.refresh_token); }
  @Public() @Post('auth/logout')
  logout(@Body() b: any) { return this.auth.logout(b?.refresh_token); }
  @Public() @Post('auth/accept-invite')
  accept(@Body() b: any, @ClientIp() ip: string | null) { need(b, 'token', 'password'); rateLimit(`invite:${ip}`, 20, 60_000); return this.auth.acceptInvite(b.token, b.password, ip); }
  @Post('auth/totp/setup')
  setup(@CurrentUser() u: AuthUser) { return this.auth.totpSetup(u); }
  @Post('auth/totp/enable')
  enable(@CurrentUser() u: AuthUser, @Body() b: any) { need(b, 'code'); return this.auth.totpEnable(u, String(b.code)); }
  @Post('auth/change-password')
  change(@CurrentUser() u: AuthUser, @Body() b: any, @ClientIp() ip: string | null) { need(b, 'current_password', 'new_password'); return this.auth.changePassword(u, b.current_password, b.new_password, ip); }
  @Get('me')
  me(@CurrentUser() u: AuthUser) { return this.auth.me(u.id); }
}
