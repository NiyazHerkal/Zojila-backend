import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { NormalizeEmail } from '../decorators/normalize-email.decorator.js';

export class LoginDto {
  @ApiProperty({ example: 'jordan_r', description: 'Username, email or phone' })
  @NormalizeEmail()
  @IsString()
  identifier!: string;

  @ApiProperty({ example: 'S0meStrongP@ss' })
  @IsString()
  password!: string;

  @ApiPropertyOptional({ example: true, description: 'Issues a longer-lived refresh token when true' })
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
