import { describe, expect, it } from 'vitest';
import { toRawPlace } from './places.provider.js';
import { toFoundPlace } from './geocoding.provider.js';
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

describe('place search (Nominatim)', () => {
  it('reads a result with an OSM id that matches the nearby ids', () => {
    expect(
      toFoundPlace({
        osm_type: 'way',
        osm_id: 26976402,
        lat: '15.3808',
        lon: '73.8314',
        name: 'Dabolim Airport',
        display_name: 'Dabolim Airport, Dabolim, South Goa, Goa, India',
        category: 'aeroway',
        type: 'aerodrome',
      }),
    ).toEqual({
      providerPlaceId: 'osm:way/26976402',
      name: 'Dabolim Airport',
      address: 'Dabolim Airport, Dabolim, South Goa, Goa, India',
      lat: 15.3808,
      lng: 73.8314,
      category: 'aeroway',
      type: 'aerodrome',
    });
  });

  it('falls back to the first part of the address for a name, and drops unusable rows', () => {
    expect(toFoundPlace({ osm_type: 'node', osm_id: 1, lat: '1', lon: '2', name: '', display_name: 'Baga Beach, Goa' })?.name).toBe(
      'Baga Beach',
    );
    expect(toFoundPlace({ osm_type: 'node', osm_id: 1, lat: 'x', lon: '2', name: 'A' })).toBeNull();
    expect(toFoundPlace({ lat: '1', lon: '2', name: 'A' })).toBeNull();
  });
});
