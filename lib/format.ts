import type { Mode } from "./modes";

export const FORMAT_VERSION = 1;

export interface TimetableJson {
  version: number;
  generatedAt: string;
  source: string;
  feedStart: string;
  days: number;
  stops: { id: string[]; name: string[]; lat: number[]; lon: number[]; station: number[]; platform: string[] };
  stations: { id: string[]; name: string[]; lat: number[]; lon: number[]; stops: number[][]; modes: number[]; routes: number[][] };
  routes: { id: string[]; short: string[]; long: string[]; mode: Mode[]; color: string[]; text: string[] };
  serviceBytes: number;
  services: string;
  patterns: {
    route: number[];
    headsign: string[];
    stopOff: number[];
    nStops: number[];
    tripOff: number[];
    nTrips: number[];
    timeOff: number[];
    shape: number[];
    distOff: number[];
    bbox: number[][];
  };
  patternStops: number[];
  trips: { id: string[]; service: number[] };
  transfers: { off: number[]; to: number[]; sec: number[] };
  shapes: { off: number[]; n: number[] };
}

export interface NetworkJson {
  feedStart: string;
  days: number;
  generatedAt: string;
  routes: { s: string; m: Mode; c: string; t: string }[];
  stations: { i: number; n: string; la: number; lo: number; m: number; r: number[] }[];
}
