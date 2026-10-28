import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { SavedPlace, SavedPlaceSource } from '../database/entities/index.js';
import type { SavePlaceDto } from './saved-places.dto.js';

/** Plenty for a traveller; stops one account from filling the table. */
export const MAX_SAVED_PLACES = 500;

export interface SavedPlaceView {
  id: string;
  source: SavedPlaceSource;
  providerPlaceId: string | null;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  category: string | null;
  savedAt: Date;
}

/**
 * A user's saved places, on the server so they follow the user across sessions and devices
 * (backend handover 2026-10-22, P-07). Private: every query is scoped to the caller.
 */
@Injectable()
export class SavedPlacesService {
  constructor(@InjectRepository(SavedPlace) private readonly places: Repository<SavedPlace>) {}

  async list(userId: string): Promise<{ items: SavedPlaceView[] }> {
    const rows = await this.places.find({ where: { userId }, order: { createdAt: 'DESC', id: 'DESC' } });
    return { items: rows.map(toView) };
  }

  /**
   * Saves a place, or returns the existing save of the same place (`created: false`). Same place
   * = same provider id, or for a dropped pin the same coordinates to 5 decimals (~1 m).
   */
  async save(userId: string, dto: SavePlaceDto): Promise<{ created: boolean; place: SavedPlaceView }> {
    const providerPlaceId = dto.providerPlaceId ?? null;
    const placeKey = providerPlaceId
      ? `provider:${providerPlaceId}`
      : `pin:${dto.lat.toFixed(5)},${dto.lng.toFixed(5)}`;
    const existing = await this.places.findOne({ where: { userId, placeKey } });
    if (existing) return { created: false, place: toView(existing) };
    if ((await this.places.countBy({ userId })) >= MAX_SAVED_PLACES) {
      throw new BadRequestException(`You can save up to ${MAX_SAVED_PLACES} places. Remove some first.`);
    }

    try {
      const saved = await this.places.save(
        this.places.create({
          userId,
          placeKey,
          source: providerPlaceId ? SavedPlaceSource.PROVIDER : SavedPlaceSource.PIN,
          providerPlaceId,
          name: dto.name,
          lat: dto.lat,
          lng: dto.lng,
          address: dto.address ?? null,
          category: dto.category ?? null,
        }),
      );
      return { created: true, place: toView(saved) };
    } catch (err) {
      // Two saves of the same place at once: the other one won, return it.
      if (!isUniqueViolation(err)) throw err;
      return { created: false, place: toView(await this.places.findOneOrFail({ where: { userId, placeKey } })) };
    }
  }

  /** 404 for another user's save too, so ids don't reveal anything. */
  async remove(userId: string, id: string): Promise<void> {
    const result = await this.places.delete({ id, userId });
    if (!result.affected) throw new NotFoundException('Saved place not found');
  }
}

function toView(p: SavedPlace): SavedPlaceView {
  return {
    id: p.id,
    source: p.source,
    providerPlaceId: p.providerPlaceId,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    address: p.address,
    category: p.category,
    savedAt: p.createdAt,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof QueryFailedError && (err.driverError as { code?: string }).code === '23505';
}
