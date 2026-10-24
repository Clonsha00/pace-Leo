export type Activity = 'walk' | 'run';
export type Point = {lat: number; lng: number; t: number; accuracy: number; segment?: number};
export type RawPoint = Point & {accepted: boolean; reason: string; run: number; referencePoint: number | null; intervalSeconds: number | null; distanceMeters: number | null; speedMps: number | null; startsSegment: boolean};
export type BreakEvent = {reason: string; at: number; fromPoint: number | null; toPoint: number | null; resumedAt: number | null; intervalSeconds?: number; errorCode?: number};
export type Energy = {kcal: number; seconds: number; outsideRangeSeconds: number};
export type EnergyEstimate = {kcal: number; knownKcal: number; gapKcal: number; gapSeconds: number};
export type Profile = {alias: string; weight: number; height: number; age: number; activity: Activity};
export type Session = Profile & {
  id: number; date: string; source: string; mode: string; demo: false;
  state: 'running' | 'paused' | 'finished'; seconds: number; runStart: number | null;
  requestedAt: number; latestTimestamp: number | null; lastDeliveryAt: number | null;
  needsNewSegment: boolean; meters: number; points: Point[]; rawPoints: RawPoint[];
  rawRun: number; rawFormatVersion: number; breakFormatVersion: number; breakEvents: BreakEvent[];
  energyMethod: 'acsm-level-rest-v2'; energy: Energy; hasDataGap: boolean;
  locationErrors: {at: number; message: string}[]; energyEstimate?: EnergyEstimate; kcal?: number; met?: number;
};
