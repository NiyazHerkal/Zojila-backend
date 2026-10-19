import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MinLength } from 'class-validator';
import { IsUsernamePolicy, USERNAME_RULES_DESCRIPTION } from '../decorators/username.decorator.js';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Jordan Rivera' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional({ example: 'jordan_r', description: USERNAME_RULES_DESCRIPTION })
  @IsOptional()
  @IsUsernamePolicy()
  username?: string;

  @ApiPropertyOptional({ example: 'https://cdn.travelgo.app/avatars/abc.jpg' })
  @IsOptional()
  @IsUrl()
  avatarUrl?: string;
}
