import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { config } from './config/config';
import { runMigrations } from './db/migrate';
import { seed } from './db/seed';

async function bootstrap() {
  await runMigrations();
  if (config.seedOnStart) await seed();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: true });
  app.set('trust proxy', 1);
  app.useBodyParser('json', { limit: '2mb' }); // signature images arrive as data URLs
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: config.corsOrigins, credentials: true, exposedHeaders: ['Content-Disposition'] });
  app.use((_req: any, res: any, next: any) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
  new Logger('Bootstrap').log(`API listening on :${config.port}/api/v1`);
}
bootstrap().catch((e) => { console.error(e); process.exit(1); });
