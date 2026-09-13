export type Coordinate = { lng: number; lat: number };

export type TravelMode = 'transit' | 'driving';

/** Road time excludes the separate five-minute walk from parking to the destination. */
export type DrivingRouteData = {
  districtId: string;
  minutes: number;
  distanceKm: number;
  coordinates: Coordinate[];
};

/** Keyed by drivingOriginKey(location), so changing an address cannot reuse another origin. */
export type DrivingRouteOverrides = Record<string, DrivingRouteData[]>;

export type Friend = {
  id: string;
  name: string;
  address: string;
  location: Coordinate;
  /** Missing on older saved plans; interpreted as transit. */
  travelMode?: TravelMode;
  /** Higher values protect this person's convenience; lower values mean willingness to travel. */
  weight: number;
  color: string;
};

export type MetroStation = {
  id: string;
  name: string;
  location: Coordinate;
  lineIds: string[];
};

export type MetroLine = {
  id: string;
  name: string;
  color: string;
  stationIds: string[];
};

export type District = {
  id: string;
  name: string;
  area: string;
  location: Coordinate;
  stationName: string;
  description: string;
  tags: string[];
  highlights: string[];
  walkMinutes: number;
};

export type RouteStep = {
  type: 'walk' | 'metro' | 'transfer' | 'drive';
  label: string;
  minutes: number;
  lineId?: string;
  lineName?: string;
  color?: string;
  from?: string;
  to?: string;
  stops?: number;
  coordinates: Coordinate[];
};

export type PersonRoute = {
  friendId: string;
  travelMode: TravelMode;
  source: 'estimate' | 'amap';
  distanceKm?: number;
  minutes: number;
  walkingMinutes: number;
  transfers: number;
  steps: RouteStep[];
  coordinates: Coordinate[];
  reachable: boolean;
};

export type Recommendation = {
  district: District;
  routes: PersonRoute[];
  score: number;
  averageMinutes: number;
  maxMinutes: number;
  spread: number;
};
