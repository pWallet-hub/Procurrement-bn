const env = process.env;
const num = (v: string | undefined, d: number) => (v ? Number(v) : d);

/** AFS single sign-on (Keycloak OIDC through AFS Command Center). Null when disabled. */
function ssoFromEnv() {
  if (env.AFS_SSO_ENABLED !== 'true') return null;
  const appUrl = (env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, '');
  const sso = {
    issuer: env.AFS_OIDC_ISSUER || '',
    /** Issuer as this API reaches Keycloak on the internal network. Defaults to AFS_OIDC_ISSUER. */
    internalIssuer: env.AFS_OIDC_INTERNAL_ISSUER || env.AFS_OIDC_ISSUER || '',
    clientId: env.AFS_OIDC_CLIENT_ID || '',
    clientSecret: env.AFS_OIDC_CLIENT_SECRET || '',
    /** Must match the redirect URI registered for the client in Keycloak. Defaults to the portal's proxied callback. */
    redirectUri: env.AFS_OIDC_REDIRECT_URI || `${appUrl}/api/v1/auth/sso/callback`,
    commandCenterUrl: env.AFS_COMMAND_CENTER_URL || '',
    serviceToken: env.AFS_SERVICE_TOKEN || '',
    appSlug: env.AFS_APP_SLUG || 'procurement',
  };
  const required: Record<string, string> = {
    AFS_OIDC_ISSUER: sso.issuer, AFS_OIDC_CLIENT_ID: sso.clientId, AFS_OIDC_CLIENT_SECRET: sso.clientSecret,
    AFS_COMMAND_CENTER_URL: sso.commandCenterUrl, AFS_SERVICE_TOKEN: sso.serviceToken,
  };
  const missing = Object.keys(required).filter((k) => !required[k]);
  if (missing.length) throw new Error(`AFS_SSO_ENABLED=true requires: ${missing.join(', ')}`);
  return sso;
}

export const config = {
  nodeEnv: env.NODE_ENV ?? 'development',
  isProd: env.NODE_ENV === 'production',
  port: num(env.PORT, 3000),
  appUrl: env.APP_URL ?? 'http://localhost:5173',
  corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
  databaseUrl: env.DATABASE_URL ?? 'postgres://afs:afs_dev_password@localhost:5432/afs',
  redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
  jwtAccessSecret: env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
  jwtRefreshSecret: env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret',
  accessTtl: num(env.ACCESS_TTL_SECONDS, 900),
  refreshTtlDays: num(env.REFRESH_TTL_DAYS, 7),
  totpRequired: env.TOTP_REQUIRED === 'true',
  /**
   * Password sign-in, invitations and password changes. Procurement users are AFS users, so production turns this off
   * and AFS single sign-on is the only way in. Defaults to on for local development and existing deployments.
   */
  passwordLogin: env.PASSWORD_LOGIN !== 'false',
  storage: {
    driver: (env.STORAGE_DRIVER ?? 'local') as 's3' | 'local',
    localDir: env.STORAGE_LOCAL_DIR ?? './storage',
    endpoint: env.S3_ENDPOINT ?? 'http://localhost:9000',
    region: env.S3_REGION ?? 'us-east-1',
    bucket: env.S3_BUCKET ?? 'afs-files',
    accessKey: env.S3_ACCESS_KEY ?? 'afsstorage',
    secretKey: env.S3_SECRET_KEY ?? 'afsstorage_dev_secret',
  },
  mail: {
    from: env.MAIL_FROM?.trim() ?? '',
    resendApiKey: env.RESEND_API_KEY?.trim() || undefined,
  },
  /** Initial administrator, created on first start if missing. Required in production. */
  admin: {
    email: (env.ADMIN_EMAIL ?? '').trim().toLowerCase(),
    password: env.ADMIN_PASSWORD ?? '',
    name: env.ADMIN_NAME ?? 'System Administrator',
    forceReset: env.ADMIN_FORCE_RESET === 'true',
  },
  sso: ssoFromEnv(),
  seedOnStart: env.SEED_ON_START === 'true',
  seedPassword: env.SEED_PASSWORD ?? 'Passw0rd!dev',
  maxUploadBytes: 20 * 1024 * 1024,
  signingTokenHours: 72,
  inviteHours: 72,
  reminderDays: 2,
};

const missingMailConfig = [
  config.mail.resendApiKey ? null : 'RESEND_API_KEY',
  config.mail.from.trim() ? null : 'MAIL_FROM',
].filter(Boolean);
if (config.nodeEnv !== 'test' && missingMailConfig.length) {
  throw new Error(`Resend email requires: ${missingMailConfig.join(', ')}`);
}

/** In production the placeholder secrets from the dev defaults must never be used. */
if (config.isProd) {
  const weak = (name: string, v: string) => (v.length < 24 || /change-me|dev_secret|dev_password|dev-/.test(v) ? name : null);
  const bad = [
    weak('JWT_ACCESS_SECRET', config.jwtAccessSecret), weak('JWT_REFRESH_SECRET', config.jwtRefreshSecret),
    weak('S3_SECRET_KEY', config.storage.secretKey),
    /dev_password/.test(config.databaseUrl) ? 'POSTGRES_PASSWORD' : null,
  ].filter(Boolean);
  if (bad.length) throw new Error(`Refusing to start in production with weak or default secrets: ${bad.join(', ')} (use random values of 24+ characters)`);
}
