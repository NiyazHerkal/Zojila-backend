import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { ProfileController, UserAvatarController } from './profile.controller.js';

/** PATCH /auth/me and profile pictures, announced live (`user:profile_updated`). */
@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [ProfileController, UserAvatarController],
})
export class ProfileModule {}
