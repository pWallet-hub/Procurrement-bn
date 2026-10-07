import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';

/** One error shape for the whole API: {error:{code,message,fields,hints}}. `hints` tells, per field path, how to fix it. */
export class AppError extends HttpException {
  constructor(status: number, public code: string, message: string, public fields?: Record<string, string>, public hints?: Record<string, string>) {
    super({ error: { code, message, ...(fields ? { fields } : {}), ...(hints && Object.keys(hints).length ? { hints } : {}) } }, status);
  }
}
export const notFound = (what = 'resource') => new AppError(404, 'not_found', `${what} not found`);
export const forbidden = (message = 'You do not have permission to do this') => new AppError(403, 'forbidden', message);
export const unauthorized = (message = 'Not signed in') => new AppError(401, 'unauthorized', message);
export const badRequest = (code: string, message: string, fields?: Record<string, string>) => new AppError(400, code, message, fields);
/** Guard failures and validation failures: HTTP 422 */
export const guardError = (code: string, message: string, fields?: Record<string, string>, hints?: Record<string, string>) =>
  new AppError(422, code.includes('.') ? code : `guard.${code}`, message, fields, hints);
export const validationError = (fields: Record<string, string>, hints?: Record<string, string>, message?: string) => {
  const n = Object.keys(fields).length;
  return new AppError(422, 'validation.failed', message ?? `${n} field${n === 1 ? ' is' : 's are'} missing or invalid. Fix the fields listed below and try again.`, fields, hints);
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private log = new Logger('HTTP');
  catch(e: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (e instanceof HttpException) {
      const body: any = e.getResponse();
      if (body?.error && typeof body.error === 'object') return res.status(e.getStatus()).json(body);
      const msg = typeof body === 'string' ? body : Array.isArray(body?.message) ? body.message.join(', ') : body?.message ?? e.message;
      return res.status(e.getStatus()).json({ error: { code: `http.${e.getStatus()}`, message: msg } });
    }
    // postgres: unique violation / bad uuid
    if (e?.code === '23505') return res.status(409).json({ error: { code: 'conflict', message: 'Already exists' } });
    if (e?.code === '22P02') return res.status(400).json({ error: { code: 'bad_request', message: 'Invalid identifier' } });
    this.log.error(e?.stack ?? String(e));
    return res.status(500).json({ error: { code: 'internal', message: 'Unexpected server error' } });
  }
}
