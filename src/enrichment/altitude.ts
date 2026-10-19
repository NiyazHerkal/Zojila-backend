export enum AltitudeZone {
  LOW = 'LOW', // below 1,500 m
  HIGH = 'HIGH', // 1,500–3,500 m
  VERY_HIGH = 'VERY_HIGH', // 3,500–5,500 m
  EXTREME = 'EXTREME', // above 5,500 m
}

const SEA_LEVEL_OXYGEN_PERCENT = 20.9;

export interface AltitudeContext {
  meters: number;
  /** Oxygen available per breath compared with sea level (air-pressure ratio), e.g. 64 at ~3,500 m. */
  oxygenPercentOfSeaLevel: number;
  /** Equivalent sea-level oxygen concentration, e.g. 13.4 (%) at ~3,500 m vs 20.9 at sea level. */
  effectiveOxygenPercent: number;
  zone: AltitudeZone;
}

/**
 * "Oxygen-level context" for a stop (PDF §2.3.2). Air is always ~20.9% oxygen, but pressure
 * falls with altitude, so each breath carries less. Uses the standard-atmosphere pressure
 * formula (valid below 11 km). Zones follow the usual altitude-medicine bands.
 */
export function altitudeContext(meters: number): AltitudeContext {
  const pressureRatio = Math.pow(1 - 2.25577e-5 * meters, 5.25588);
  const zone =
    meters < 1500
      ? AltitudeZone.LOW
      : meters < 3500
        ? AltitudeZone.HIGH
        : meters < 5500
          ? AltitudeZone.VERY_HIGH
          : AltitudeZone.EXTREME;
  return {
    meters: Math.round(meters),
    oxygenPercentOfSeaLevel: Math.round(pressureRatio * 100),
    effectiveOxygenPercent:
      Math.round(SEA_LEVEL_OXYGEN_PERCENT * pressureRatio * 10) / 10,
    zone,
  };
}
