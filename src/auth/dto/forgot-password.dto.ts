import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsPhoneNumber, ValidateIf } from 'class-validator';
import { EmptyToUndefined } from '../decorators/empty-to-undefined.decorator.js';
import { NormalizeEmail } from '../decorators/normalize-email.decorator.js';

export class ForgotPasswordDto {
  @ApiPropertyOptional({ example: 'rider@example.com' })
  @EmptyToUndefined()
  @ValidateIf((dto: ForgotPasswordDto) => !dto.phone)
  @NormalizeEmail()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @EmptyToUndefined()
  @ValidateIf((dto: ForgotPasswordDto) => !dto.email)
  @IsPhoneNumber()
  phone?: string;
}
