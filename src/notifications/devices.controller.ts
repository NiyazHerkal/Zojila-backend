import { Body, Controller, Delete, Injectable, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/strategies/jwt.strategy.js';
import { DeviceToken } from '../database/entities/index.js';
import { RegisterDeviceDto, UnregisterDeviceDto } from './dto/register-device.dto.js';

@Injectable()
export class DevicesService {
  constructor(@InjectRepository(DeviceToken) private readonly devices: Repository<DeviceToken>) {}

  /** Upsert by token: re-registering refreshes it, and a token seen under another user moves to this one. */
  async register(userId: string, dto: RegisterDeviceDto) {
    await this.devices.upsert({ userId, token: dto.token, platform: dto.platform }, ['token']);
    return { registered: true };
  }

  async unregister(userId: string, token: string): Promise<void> {
    await this.devices.delete({ userId, token });
  }
}

@ApiTags('devices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post()
  @ApiOperation({ summary: 'Register this device for push notifications (call after login and whenever FCM gives a new token).' })
  register(@CurrentUser() user: JwtPayload, @Body() dto: RegisterDeviceDto) {
    return this.devicesService.register(user.sub, dto);
  }

  @Delete()
  @ApiOperation({ summary: 'Stop push notifications to this device (call before logout).' })
  unregister(@CurrentUser() user: JwtPayload, @Body() dto: UnregisterDeviceDto) {
    return this.devicesService.unregister(user.sub, dto.token);
  }
}
