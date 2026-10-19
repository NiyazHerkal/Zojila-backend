import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

// Requires a reachable Postgres (local install or `docker compose up -d`): TypeORM connects on app init.
describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({ db: 'connected', version: expect.any(String), uptimeSeconds: expect.any(Number) });
        // `degraded` if Redis isn't running on this machine; still 200.
        expect(['ok', 'degraded']).toContain(res.body.status);
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
