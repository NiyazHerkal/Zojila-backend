import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsPhoneNumber, IsString, IsUUID, Length, ValidateIf } from 'class-validator';
import { EmptyToUndefined } from '../decorators/empty-to-undefined.decorator.js';
import { NormalizeEmail } from '../decorators/normalize-email.decorator.js';

/** Identify the account by `userId` (from signup) or by the email/phone the code was sent to. */
export class VerifyDto {
  @ApiPropertyOptional({ example: 'e3b0c442-...', description: 'userId returned from /auth/signup' })
  @EmptyToUndefined()
  // Checked whenever it's sent (it's used first), and required when email/phone aren't.
  @ValidateIf((dto: VerifyDto) => dto.userId !== undefined || (!dto.email && !dto.phone))
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ example: 'rider@example.com', description: 'Alternative to userId' })
  @EmptyToUndefined()
  @ValidateIf((dto: VerifyDto) => !!dto.email)
  @NormalizeEmail()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+919876543210', description: 'Alternative to userId' })
  @EmptyToUndefined()
  @ValidateIf((dto: VerifyDto) => !!dto.phone)
  @IsPhoneNumber()
  phone?: string;

  @ApiProperty({ example: '123456', description: '6-digit code sent via email/SMS' })
  @IsString()
  @Length(6, 6)
  code!: string;
}
