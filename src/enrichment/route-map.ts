export interface MapPoint {
  lat: number;
  lng: number;
}

export interface TilePlacement {
  z: number;
  x: number;
  y: number;
  /** Top-left corner and size of the tile inside the map box, in output units (e.g. PDF points). */
  left: number;
  top: number;
  size: number;
}

export interface RouteMapPlan {
  zoom: number;
  tiles: TilePlacement[];
  /** Where a coordinate falls inside the map box, in output units. */
  project(point: MapPoint): { x: number; y: number };
}

const TILE_PX = 256;
const MAX_ZOOM = 15;
const SINGLE_POINT_ZOOM = 12;
const PADDING = 0.12; // keep pins away from the edges

/**
 * Lays out Web Mercator tiles so every route point fits in a `width` × `height` box. `pxPerUnit`
 * > 1 draws tiles smaller than 256 units (sharper in print). Pure maths, no I/O, so it's unit-testable.
 */
export function planRouteMap(
  points: MapPoint[],
  width: number,
  height: number,
  pxPerUnit = 2,
): RouteMapPlan {
  const boxW = width * pxPerUnit;
  const boxH = height * pxPerUnit;

  const pick = () => {
    if (points.length === 1) return SINGLE_POINT_ZOOM;
    for (let z = MAX_ZOOM; z >= 1; z--) {
      const px = points.map((p) => worldPx(p, z));
      const spanX =
        Math.max(...px.map((p) => p.x)) - Math.min(...px.map((p) => p.x));
      const spanY =
        Math.max(...px.map((p) => p.y)) - Math.min(...px.map((p) => p.y));
      if (
        spanX <= boxW * (1 - 2 * PADDING) &&
        spanY <= boxH * (1 - 2 * PADDING)
      )
        return z;
    }
    return 1;
  };
  const zoom = pick();

  const px = points.map((p) => worldPx(p, zoom));
  const centerX =
    (Math.max(...px.map((p) => p.x)) + Math.min(...px.map((p) => p.x))) / 2;
  const centerY =
    (Math.max(...px.map((p) => p.y)) + Math.min(...px.map((p) => p.y))) / 2;
  const originX = centerX - boxW / 2;
  const originY = centerY - boxH / 2;

  const tileCount = 2 ** zoom;
  const tiles: TilePlacement[] = [];
  for (
    let ty = Math.floor(originY / TILE_PX);
    ty <= Math.floor((originY + boxH) / TILE_PX);
    ty++
  ) {
    if (ty < 0 || ty >= tileCount) continue; // nothing beyond the poles
    for (
      let tx = Math.floor(originX / TILE_PX);
      tx <= Math.floor((originX + boxW) / TILE_PX);
      tx++
    ) {
      tiles.push({
        z: zoom,
        x: ((tx % tileCount) + tileCount) % tileCount, // wrap across the antimeridian
        y: ty,
        left: (tx * TILE_PX - originX) / pxPerUnit,
        top: (ty * TILE_PX - originY) / pxPerUnit,
        size: TILE_PX / pxPerUnit,
      });
    }
  }

  return {
    zoom,
    tiles,
    project: (p) => {
      const w = worldPx(p, zoom);
      return { x: (w.x - originX) / pxPerUnit, y: (w.y - originY) / pxPerUnit };
    },
  };
}

function worldPx(p: MapPoint, zoom: number): { x: number; y: number } {
  const scale = TILE_PX * 2 ** zoom;
  const lat = Math.max(Math.min(p.lat, 85.0511), -85.0511); // Web Mercator limit
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((p.lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}
