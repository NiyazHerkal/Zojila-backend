import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsPhoneNumber, ValidateIf } from 'class-validator';
import { NormalizeEmail } from '../../auth/decorators/normalize-email.decorator.js';
import { IsUsernamePolicy } from '../../auth/decorators/username.decorator.js';
import { GroupRole } from '../../database/entities/index.js';

/** Identify the registered user by exactly one of username, email or phone. */
export class AddMemberDto {
  @ApiPropertyOptional({ example: 'jordan_r' })
  @ValidateIf((dto: AddMemberDto) => !dto.email && !dto.phone)
  @IsUsernamePolicy()
  username?: string;

  @ApiPropertyOptional({ example: 'friend@example.com' })
  @ValidateIf((dto: AddMemberDto) => !dto.username && !dto.phone)
  @NormalizeEmail()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @ValidateIf((dto: AddMemberDto) => !dto.username && !dto.email)
  @IsPhoneNumber()
  phone?: string;

  @ApiPropertyOptional({ enum: GroupRole, default: GroupRole.VIEWER })
  @IsOptional()
  @IsEnum(GroupRole)
  role?: GroupRole;
}
