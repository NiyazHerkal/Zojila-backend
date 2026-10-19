import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService, type Health } from './app.service.js';

describe('AppController', () => {
  let appController: AppController;
  let health: Health;
  const res = { status: vi.fn() };

  beforeEach(async () => {
    res.status.mockClear();
    health = { status: 'ok', db: 'connected', redis: 'connected', version: '0.0.1', uptimeSeconds: 5 };
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: AppService, useValue: { getHealth: async () => health } }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('reports ok with 200', async () => {
      expect(await appController.getHealth(res as never)).toEqual(health);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('stays 200 when only Redis is down', async () => {
      health = { ...health, status: 'degraded', redis: 'unreachable' };
      expect((await appController.getHealth(res as never)).status).toBe('degraded');
      expect(res.status).not.toHaveBeenCalled();
    });

    it('answers 503 when the database is down', async () => {
      health = { ...health, status: 'down', db: 'unreachable' };
      await appController.getHealth(res as never);
      expect(res.status).toHaveBeenCalledWith(503);
    });
  });
});
