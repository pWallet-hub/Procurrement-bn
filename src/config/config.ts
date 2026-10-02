const env = process.env;
const num = (v: string | undefined, d: number) => (v ? Number(v) : d);

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
    from: env.MAIL_FROM ?? 'AfS Procurement <procurement@afs.local>',
    host: env.SMTP_HOST ?? 'localhost',
    port: num(env.SMTP_PORT, 1025),
    user: env.SMTP_USER || undefined,
    pass: env.SMTP_PASS || undefined,
    secure: env.SMTP_SECURE === 'true',
  },
  /** Initial administrator, created on first start if missing. Required in production. */
  admin: {
    email: (env.ADMIN_EMAIL ?? '').trim().toLowerCase(),
    password: env.ADMIN_PASSWORD ?? '',
    name: env.ADMIN_NAME ?? 'System Administrator',
    forceReset: env.ADMIN_FORCE_RESET === 'true',
  },
  seedOnStart: env.SEED_ON_START === 'true',
  seedPassword: env.SEED_PASSWORD ?? 'Passw0rd!dev',
  maxUploadBytes: 20 * 1024 * 1024,
  signingTokenHours: 72,
  inviteHours: 72,
  reminderDays: 2,
};
