import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { perMinute, RATE_LIMITS } from '../security/rate-limit.js';
import { AuthService } from './auth.service.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { OtpLoginDto } from './dto/otp-login.dto.js';
import { OtpRequestDto } from './dto/otp-request.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { ResendVerificationDto } from './dto/resend-verification.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { SignupDto } from './dto/signup.dto.js';
import { UsernameAvailableDto } from './dto/username-available.dto.js';
import { VerifyDto } from './dto/verify.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import type { JwtPayload } from './strategies/jwt.strategy.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  @Throttle(perMinute(RATE_LIMITS.signup))
  @ApiOperation({ summary: 'Register with email or phone + password. Sends a verification code.' })
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Get('username-available')
  @Throttle(perMinute(RATE_LIMITS.usernameCheck))
  @ApiOperation({ summary: 'Check whether a username is free (for live validation on the signup form).' })
  usernameAvailable(@Query() dto: UsernameAvailableDto) {
    return this.authService.usernameAvailable(dto.username);
  }

  @Post('verify')
  @Throttle(perMinute(RATE_LIMITS.codeEntry))
  @ApiOperation({
    summary: 'Confirm the signup code (identify by userId, email or phone). Returns tokens. 5 wrong tries cancels the code (429).',
  })
  verify(@Body() dto: VerifyDto) {
    return this.authService.verify(dto);
  }

  @Post('resend-verification')
  @Throttle(perMinute(RATE_LIMITS.codeSend))
  @ApiOperation({ summary: 'Send a new signup code to an unverified account. At most once per 60 s.' })
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto);
  }

  @Post('login')
  @Throttle(perMinute(RATE_LIMITS.login))
  @ApiOperation({ summary: 'Log in with email/phone + password.' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('otp/request')
  @Throttle(perMinute(RATE_LIMITS.codeSend))
  @ApiOperation({ summary: 'Request a login OTP via SMS for phone-based login.' })
  requestOtpLogin(@Body() dto: OtpRequestDto) {
    return this.authService.requestOtpLogin(dto);
  }

  @Post('otp/login')
  @Throttle(perMinute(RATE_LIMITS.codeEntry))
  @ApiOperation({ summary: 'Log in with phone + OTP.' })
  loginWithOtp(@Body() dto: OtpLoginDto) {
    return this.authService.loginWithOtp(dto);
  }

  @Post('refresh')
  @Throttle(perMinute(RATE_LIMITS.refresh))
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair.' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Revoke the current refresh token.' })
  logout(@CurrentUser() user: JwtPayload) {
    return this.authService.logout(user.sub);
  }

  @Post('forgot-password')
  @Throttle(perMinute(RATE_LIMITS.codeSend))
  @ApiOperation({ summary: 'Request a password reset code via email/SMS.' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @Throttle(perMinute(RATE_LIMITS.codeEntry))
  @ApiOperation({ summary: 'Reset password using the emailed/texted code.' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Get the current user's profile." })
  me(@CurrentUser() user: JwtPayload) {
    return this.authService.getProfile(user.sub);
  }
}
