import { ApiProperty } from '@nestjs/swagger';
import { IsUsernamePolicy, USERNAME_RULES_DESCRIPTION } from '../decorators/username.decorator.js';

export class UsernameAvailableDto {
  @ApiProperty({ example: 'jordan_r', description: USERNAME_RULES_DESCRIPTION })
  @IsUsernamePolicy()
  username!: string;
}
