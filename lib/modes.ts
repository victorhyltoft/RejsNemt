export type Mode = "stog" | "metro" | "letbane" | "tog" | "bus" | "faerge";

export const MODE_LABEL: Record<Mode, string> = {
  stog: "S-tog",
  metro: "Metro",
  letbane: "Letbane",
  tog: "Tog",
  bus: "Bus",
  faerge: "Færge",
};

export const MODE_BIT: Record<Mode, number> = { stog: 1, metro: 2, letbane: 4, tog: 8, bus: 16, faerge: 32 };

export function modeFromRouteType(t: number, short = ""): Mode {
  if (t === 109) return "stog";
  if (t === 1 || (t >= 400 && t <= 405)) return "metro";
  if (t === 0 || (t >= 900 && t <= 906)) return "letbane";
  if (t === 2 || (t >= 100 && t <= 117)) return /^(A|B|Bx|C|E|F|H)$/.test(short) ? "stog" : "tog";
  if (t === 4 || (t >= 1000 && t <= 1200)) return "faerge";
  return "bus";
}

const KNOWN: Record<string, [string, string]> = {
  A: ["#0C8BD4", "#FFFFFF"],
  B: ["#3FA34D", "#FFFFFF"],
  Bx: ["#3FA34D", "#FFFFFF"],
  C: ["#EF8A00", "#FFFFFF"],
  E: ["#7B5AA6", "#FFFFFF"],
  F: ["#BFD62F", "#111111"],
  H: ["#E2001A", "#FFFFFF"],
  M1: ["#00814F", "#FFFFFF"],
  M2: ["#F2B900", "#111111"],
  M3: ["#E3001B", "#FFFFFF"],
  M4: ["#0091D1", "#FFFFFF"],
};

const MODE_DEFAULT: Record<Mode, [string, string]> = {
  stog: ["#0C8BD4", "#FFFFFF"],
  metro: ["#00814F", "#FFFFFF"],
  letbane: ["#00A19A", "#FFFFFF"],
  tog: ["#4B5563", "#FFFFFF"],
  bus: ["#2A5CAA", "#FFFFFF"],
  faerge: ["#0E7490", "#FFFFFF"],
};

export function lineColors(short: string, mode: Mode, color?: string, text?: string): [string, string] {
  if (KNOWN[short] && (mode === "stog" || mode === "metro")) return KNOWN[short];
  if (color && /^[0-9a-f]{6}$/i.test(color) && color.toUpperCase() !== "FFFFFF")
    return ["#" + color, text && /^[0-9a-f]{6}$/i.test(text) ? "#" + text : "#FFFFFF"];
  if (mode === "bus" && /A$/.test(short)) return ["#F5B700", "#111111"];
  if (mode === "bus" && /E$/.test(short)) return ["#2E7D32", "#FFFFFF"];
  return MODE_DEFAULT[mode];
}
