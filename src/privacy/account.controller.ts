import { Body, Controller, Delete, Get, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/strategies/jwt.strategy.js';
import { perMinute, RATE_LIMITS } from '../security/rate-limit.js';
import { AccountService } from './account.service.js';

export class DeleteAccountDto {
  @ApiProperty({ description: 'Your current password, to confirm' })
  @IsString()
  @MinLength(1)
  @MaxLength(72)
  password!: string;
}

/** GDPR: download my data, delete my account (PDF §4). */
@ApiTags('auth')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('auth/me')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get('export')
  @ApiOperation({ summary: 'Download everything stored about me (JSON file).' })
  async export(@CurrentUser() user: JwtPayload, @Res({ passthrough: true }) res: Response) {
    const data = await this.account.export(user.sub);
    res.setHeader('Content-Disposition', `attachment; filename="travelgo-my-data-${new Date().toLocaleDateString('en-CA')}.json"`);
    return data;
  }

  @Delete()
  @Throttle(perMinute(RATE_LIMITS.accountDeletion))
  @ApiOperation({
    summary:
      'Delete my account (needs my password). Personal data is erased; my messages and expenses stay for the group as "Deleted user".',
  })
  async delete(@CurrentUser() user: JwtPayload, @Body() dto: DeleteAccountDto) {
    await this.account.delete(user.sub, dto.password);
  }
}
