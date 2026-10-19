import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateWaypointDto } from './create-waypoint.dto.js';

/** Send only the fields to change. `date: null` / `notes: null` clears them. Use the order endpoint to move a pin. */
export class UpdateWaypointDto extends PartialType(OmitType(CreateWaypointDto, ['position'] as const)) {}
