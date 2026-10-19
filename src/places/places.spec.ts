import { describe, expect, it } from 'vitest';
import { toRawPlace } from './places.provider.js';
import { distanceMeters } from '../enrichment/geo.js';

describe('places', () => {
  it('reads OSM nodes and ways (centre) with their address and hours', () => {
    expect(
      toRawPlace({
        type: 'node',
        id: 1,
        lat: 32.25,
        lon: 77.18,
        tags: { amenity: 'fuel', brand: 'Indian Oil', 'addr:street': 'Mall Road', 'addr:city': 'Manali', opening_hours: '24/7' },
      }),
    ).toEqual({
      id: 'osm:node/1',
      name: 'Indian Oil', // no name: falls back to the brand
      kind: 'fuel',
      lat: 32.25,
      lng: 77.18,
      address: 'Mall Road, Manali',
      openingHours: '24/7',
      phone: null,
      website: null,
      brand: 'Indian Oil',
    });
    expect(toRawPlace({ type: 'way', id: 2, center: { lat: 1, lon: 2 }, tags: { shop: 'tyres' } })).toMatchObject({
      id: 'osm:way/2',
      name: null,
      kind: 'tyres',
      lat: 1,
      lng: 2,
      address: null,
    });
    expect(toRawPlace({ type: 'relation', id: 3 })).toBeNull(); // no position
  });

  it('measures distances on the globe', () => {
    expect(Math.round(distanceMeters(32.2432, 77.1892, 34.1526, 77.5771) / 1000)).toBe(215); // Manali → Leh, straight line
    expect(distanceMeters(10, 10, 10, 10)).toBe(0);
  });
});
