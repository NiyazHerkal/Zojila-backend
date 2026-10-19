import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../database/entities/index.js';
import { EmailService } from '../notifications/email.service.js';
import { OtpDeliveryService } from '../notifications/otp-delivery.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AvatarService } from './avatar.service.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [AuthService, AvatarService, JwtStrategy, OtpDeliveryService, EmailService],
  // PassportModule backs JwtAuthGuard — any module using the guard imports AuthModule.
  // EmailService (Brevo) is shared with GroupsModule for email invites.
  // AuthService + AvatarService: the profile routes (ProfileModule, which also needs realtime).
  exports: [PassportModule, EmailService, AuthService, AvatarService],
})
export class AuthModule {}
