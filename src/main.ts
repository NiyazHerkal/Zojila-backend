import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { assertProductionReady } from './security/production-checks.js';
import { initSentry } from './security/sentry.js';

async function bootstrap() {
  // AppModule's ConfigModule has loaded .env into process.env by now.
  assertProductionReady();
  const sentry = initSentry();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors();
  // Security headers (HSTS, nosniff, frameguard, referrer policy…). CSP is off: this is a JSON
  // API, and Swagger UI at /docs needs inline scripts.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  // Real client IPs for rate limiting behind a proxy. Default: trust proxies on this machine
  // only (e.g. the ngrok agent). In production set TRUST_PROXY to the load balancer setup.
  app.set('trust proxy', trustProxy(process.env.TRUST_PROXY));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const config = new DocumentBuilder()
    .setTitle('TravelGo API')
    .setDescription('Backend API for the TravelGo mobile app. See backend/context/ for the full build plan.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-Ops-Key' }, 'ops-key') // team-only /ops routes
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(process.env.PORT ?? 3000);
  if (!sentry) new Logger('Bootstrap').warn('Sentry not configured: errors are only logged (set SENTRY_DSN)');
}

/** "true" / "false" / a hop count / a list of addresses or keywords like "loopback". */
function trustProxy(value: string | undefined): boolean | number | string {
  const v = value?.trim();
  if (!v) return 'loopback';
  if (v === 'true' || v === 'false') return v === 'true';
  return /^\d+$/.test(v) ? Number(v) : v;
}

await bootstrap();
