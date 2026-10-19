import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { Feedback, Group, GroupMember, User } from '../database/entities/index.js';
import { OpsController } from '../ops/ops.controller.js';
import { OpsKeyGuard } from '../ops/ops-key.guard.js';
import { OpsService } from '../ops/ops.service.js';
import { FeedbackController } from './feedback.controller.js';
import { FeedbackService } from './feedback.service.js';

/** Phase 13 closed beta: in-app feedback, plus the team's ops endpoints (metrics + triage). */
@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([Feedback, GroupMember, User, Group])],
  controllers: [FeedbackController, OpsController],
  providers: [FeedbackService, OpsService, OpsKeyGuard],
})
export class FeedbackModule {}
