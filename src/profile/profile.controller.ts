import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService, type ProfileChange } from '../auth/auth.service.js';
import { AvatarService, type UploadedAvatar } from '../auth/avatar.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { UpdateProfileDto } from '../auth/dto/update-profile.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/strategies/jwt.strategy.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { perMinute, RATE_LIMITS } from '../security/rate-limit.js';
import { IMAGE_MAX_BYTES } from '../storage/image-file.js';

export const PROFILE_UPDATED_EVENT = 'user:profile_updated';

/**
 * Changes to what other people see of you: username, name, profile picture. Separate from
 * AuthModule because it announces them live, and the realtime module depends on AuthModule.
 */
@ApiTags('auth')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('auth/me')
export class ProfileController {
  constructor(
    private readonly auth: AuthService,
    private readonly realtime: RealtimeService,
  ) {}

  @Patch()
  @ApiOperation({ summary: "Update the current user's profile (username/name/avatar)." })
  async updateProfile(@CurrentUser() user: JwtPayload, @Body() dto: UpdateProfileDto) {
    return this.announce(await this.auth.updateProfile(user.sub, dto));
  }

  @Post('avatar')
  @HttpCode(200)
  @Throttle(perMinute(RATE_LIMITS.upload))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @ApiOperation({ summary: 'Set or replace your profile picture: JPEG/PNG/WebP, max 5 MB, field `file`. Returns the profile.' })
  // Allow a little over the limit here so the service can answer with a clear 413 message.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMAGE_MAX_BYTES + 1, files: 1 } }))
  async putAvatar(@CurrentUser() user: JwtPayload, @UploadedFile() file: UploadedAvatar | undefined) {
    return this.announce(await this.auth.putAvatar(user.sub, file));
  }

  @Delete('avatar')
  @ApiOperation({ summary: 'Remove your profile picture (apps show initials again). Returns the profile.' })
  async removeAvatar(@CurrentUser() user: JwtPayload) {
    return this.announce(await this.auth.removeAvatar(user.sub));
  }

  /**
   * `user:profile_updated` to everyone who shares a trip with the user, and to their own other
   * devices, so names and pictures change on screen without a reload.
   */
  private async announce({ profile, changed }: ProfileChange) {
    if (changed) {
      const ids = [profile.id, ...(await this.realtime.coMemberIds(profile.id))];
      this.realtime.emitToUsers(ids, PROFILE_UPDATED_EVENT, {
        userId: profile.id,
        username: profile.username,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        timestamp: new Date(),
      });
    }
    return profile;
  }
}

@ApiTags('auth')
@Controller('users')
export class UserAvatarController {
  constructor(private readonly avatars: AvatarService) {}

  @Get(':userId/avatar')
  @ApiProduces('image/jpeg', 'image/png', 'image/webp')
  // No token needed: the URL carries a random `?v=` and is only handed to people who can see the
  // user (trip members, live-share recipients), so image widgets load it directly. A new upload
  // gets a new URL, so it's safe to cache for good.
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  @ApiOperation({ summary: 'Download a profile picture. Use `avatarUrl` from any user object; no auth.' })
  async getAvatar(@Param('userId', ParseUUIDPipe) userId: string) {
    const { data, contentType } = await this.avatars.get(userId);
    return new StreamableFile(data, { type: contentType, length: data.length });
  }
}
