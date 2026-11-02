import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateGroupDto } from '../groups/dto/create-group.dto.js';
import { UpdateGroupDto } from '../groups/dto/update-group.dto.js';
import { CreateWaypointDto } from '../itinerary/dto/create-waypoint.dto.js';
import { UpdateWaypointDto } from '../itinerary/dto/update-waypoint.dto.js';
import { UpdateExpenseDto } from '../expenses/dto/expense.dto.js';

describe('API update and text validation', () => {
  it.each([
    [UpdateGroupDto, ['name', 'description', 'tripStart', 'tripEnd', 'currency']],
    [UpdateExpenseDto, ['amount', 'category', 'date', 'splitType']],
    [UpdateWaypointDto, ['name', 'lat', 'lng']],
  ] as [new () => object, string[]][])('rejects null required fields but permits omission in %s', async (dto, fields) => {
    expect(await validate(plainToInstance(dto, {}))).toEqual([]);
    for (const field of fields) {
      const errors = await validate(plainToInstance(dto, { [field]: null }));
      expect(errors.map((error) => error.property)).toContain(field);
    }
  });

  it('still allows explicit null to clear nullable expense and stop fields', async () => {
    expect(await validate(plainToInstance(UpdateExpenseDto, { description: null, notes: null }))).toEqual([]);
    expect(await validate(plainToInstance(UpdateWaypointDto, {
      notes: null, date: null, startTime: null, endTime: null, address: null, providerPlaceId: null,
    }))).toEqual([]);
  });

  it('trims group and stop names and rejects whitespace-only names and group descriptions', async () => {
    const group = plainToInstance(CreateGroupDto, {
      name: '  Ride  ', description: '  Trip  ', tripStart: '2026-11-02', tripEnd: '2026-11-03',
    });
    const stop = plainToInstance(CreateWaypointDto, { name: '  Stop  ', lat: 10, lng: 20 });
    expect(group.name).toBe('Ride');
    expect(group.description).toBe('Trip');
    expect(stop.name).toBe('Stop');
    expect(await validate(group)).toEqual([]);
    expect(await validate(stop)).toEqual([]);
    expect((await validate(plainToInstance(CreateGroupDto, { ...group, name: ' ', description: '\t' })))
      .map((error) => error.property)).toEqual(expect.arrayContaining(['name', 'description']));
    expect((await validate(plainToInstance(CreateWaypointDto, { ...stop, name: '\t' })))
      .map((error) => error.property)).toContain('name');
  });
});
