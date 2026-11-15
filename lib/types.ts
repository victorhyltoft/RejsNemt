import type { Mode } from "./modes";

export interface RouteRef {
  short: string;
  mode: Mode;
  color: string;
  text: string;
}

export interface StopRef {
  station: number;
  name: string;
  lat: number;
  lon: number;
  platform?: string;
}

export interface TransitLeg {
  type: "transit";
  route: RouteRef;
  headsign: string;
  tripId: string;
  serviceDate: string;
  pattern: number;
  fromIdx: number;
  toIdx: number;
  from: StopRef;
  to: StopRef;
  dep: number;
  arr: number;
  stops: { name: string; time: number }[];
  shape: [number, number][];
}

export interface WalkLeg {
  type: "walk";
  from: StopRef;
  to: StopRef;
  dep: number;
  arr: number;
}

export type Leg = TransitLeg | WalkLeg;

export interface Itinerary {
  dep: number;
  arr: number;
  transfers: number;
  legs: Leg[];
}

export interface Departure {
  tripId: string;
  serviceDate: string;
  route: RouteRef;
  headsign: string;
  time: number;
  platform?: string;
  stop: number;
  pattern: number;
  idx: number;
  rt?: Realtime;
}

export interface Realtime {
  delay: number;
  live: boolean;
  cancelled?: boolean;
  track?: string;
  at: number;
  source: "api" | "mock";
}

export interface VehicleTrip {
  tripId: string;
  serviceDate: string;
  pattern: number;
  route: RouteRef;
  headsign: string;
  base: number;
  times: number[];
  rt?: Realtime;
}

export interface PatternGeo {
  pattern: number;
  coords: [number, number][];
  cum: number[];
  stopDist: number[];
  stops: { name: string; lat: number; lon: number }[];
}
