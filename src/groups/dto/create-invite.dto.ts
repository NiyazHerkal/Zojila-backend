import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsInt, IsOptional, IsPhoneNumber, Max, Min, ValidateIf } from 'class-validator';
import { NormalizeEmail } from '../../auth/decorators/normalize-email.decorator.js';
import { InviteChannel } from '../../database/entities/index.js';

export class CreateInviteDto {
  @ApiProperty({
    enum: InviteChannel,
    description: 'LINK = multi-use shareable link; EMAIL / SMS = invitation to one person',
  })
  @IsEnum(InviteChannel)
  channel!: InviteChannel;

  @ApiPropertyOptional({ example: 'friend@example.com', description: 'Required when channel is EMAIL' })
  @ValidateIf((dto: CreateInviteDto) => dto.channel === InviteChannel.EMAIL)
  @NormalizeEmail()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+919876543210', description: 'Required when channel is SMS' })
  @ValidateIf((dto: CreateInviteDto) => dto.channel === InviteChannel.SMS)
  @IsPhoneNumber()
  phone?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 30, default: 7 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  expiresInDays?: number;
}
