import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsPhoneNumber, IsString, MinLength, ValidateIf } from 'class-validator';
import { EmptyToUndefined } from '../decorators/empty-to-undefined.decorator.js';
import { NormalizeEmail } from '../decorators/normalize-email.decorator.js';
import { IsPasswordPolicy, PASSWORD_RULES_DESCRIPTION } from '../decorators/strong-password.decorator.js';
import { IsUsernamePolicy, USERNAME_RULES_DESCRIPTION } from '../decorators/username.decorator.js';

export class SignupDto {
  @ApiPropertyOptional({ example: 'rider@example.com' })
  @EmptyToUndefined()
  @ValidateIf((dto: SignupDto) => !dto.phone)
  @NormalizeEmail()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @EmptyToUndefined()
  @ValidateIf((dto: SignupDto) => !dto.email)
  @IsPhoneNumber()
  phone?: string;

  @ApiProperty({ example: 'jordan_r', description: USERNAME_RULES_DESCRIPTION })
  @IsUsernamePolicy()
  username!: string;

  @ApiProperty({ example: 'S0meStrongP@ss', description: PASSWORD_RULES_DESCRIPTION })
  @IsString()
  @IsPasswordPolicy()
  password!: string;

  @ApiProperty({ example: 'Jordan Rivera' })
  @IsString()
  @MinLength(1)
  name!: string;
}
