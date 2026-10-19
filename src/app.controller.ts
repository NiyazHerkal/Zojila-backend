import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  @SkipThrottle() // uptime monitors poll it
  @ApiOperation({ summary: 'Health for uptime monitors: database, Redis, version, uptime.' })
  @ApiResponse({ status: 200, description: '`ok`, or `degraded` when Redis is down (live location off)' })
  @ApiResponse({ status: 503, description: '`down`: the database is unreachable' })
  async getHealth(@Res({ passthrough: true }) res: Response) {
    const health = await this.appService.getHealth();
    if (health.status === 'down') res.status(503);
    return health;
  }
}
