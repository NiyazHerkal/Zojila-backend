import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateWaypointDto } from './create-waypoint.dto.js';

/**
 * Send only the fields to change. `null` clears date, times, notes, address and providerPlaceId.
 * Moving the pin (lat/lng) clears address and providerPlaceId unless new ones are sent.
 * Use the order endpoint to move a pin within the route.
 */
export class UpdateWaypointDto extends PartialType(OmitType(CreateWaypointDto, ['position'] as const)) {}
