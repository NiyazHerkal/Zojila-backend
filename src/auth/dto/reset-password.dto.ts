import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsPhoneNumber, IsString, Length, ValidateIf } from 'class-validator';
import { EmptyToUndefined } from '../decorators/empty-to-undefined.decorator.js';
import { NormalizeEmail } from '../decorators/normalize-email.decorator.js';
import { IsPasswordPolicy, PASSWORD_RULES_DESCRIPTION } from '../decorators/strong-password.decorator.js';

export class ResetPasswordDto {
  @ApiPropertyOptional({ example: 'rider@example.com' })
  @EmptyToUndefined()
  @ValidateIf((dto: ResetPasswordDto) => !dto.phone)
  @NormalizeEmail()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @EmptyToUndefined()
  @ValidateIf((dto: ResetPasswordDto) => !dto.email)
  @IsPhoneNumber()
  phone?: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6)
  code!: string;

  @ApiProperty({ example: 'N3wStrongP@ss', description: PASSWORD_RULES_DESCRIPTION })
  @IsString()
  @IsPasswordPolicy()
  newPassword!: string;
}
