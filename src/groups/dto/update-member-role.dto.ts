import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { GroupRole } from '../../database/entities/index.js';

export class UpdateMemberRoleDto {
  @ApiProperty({ enum: GroupRole })
  @IsEnum(GroupRole)
  role!: GroupRole;
}
