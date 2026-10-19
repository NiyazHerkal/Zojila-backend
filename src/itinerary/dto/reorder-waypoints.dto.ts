import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class ReorderWaypointsDto {
  @ApiProperty({
    type: [String],
    description: 'Every waypoint id of the draft, in the new order (first = start, last = end)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  waypointIds!: string[];
}
