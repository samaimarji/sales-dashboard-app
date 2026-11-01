import { KPI_BY_CODE } from "./catalog";
import { isVolume } from "./value";

export interface MonthProgress {
  date: Date;
  month: string; // YYYY-MM-01
  day: number;
  daysInMonth: number;
  /** share of the month gone, e.g. 30/31 = 0.97 */
  share: number;
  daysLeft: number;
}

export function monthProgress(date: Date): MonthProgress {
  const day = date.getUTCDate();
  const daysInMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  return {
    date, day, daysInMonth, share: day / daysInMonth, daysLeft: daysInMonth - day,
    month: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`,
  };
}

export type Status = "ahead" | "on" | "close" | "behind" | "none";

export interface Evaluation {
  actual: number | undefined;
  goal: number | undefined;
  /** what the number should be by today (volume KPIs), or the target (rates) */
  target: number | undefined;
  /** actual vs target: 1 = exactly on pace */
  pct: number | undefined;
  status: Status;
  /** where the month ends at this pace (volume KPIs) */
  projected?: number;
  neededPerDay?: number;
}

/** Same colors as the Sales Dashboard sheet: blue 150%+, green on pace, orange 70%+, red behind. */
export function statusOf(pct: number | undefined): Status {
  if (pct === undefined || !Number.isFinite(pct)) return "none";
  if (pct >= 1.5) return "ahead";
  if (pct >= 1) return "on";
  if (pct >= 0.7) return "close";
  return "behind";
}

export function evaluate(code: string, actual: number | undefined, goal: number | undefined, mp: MonthProgress): Evaluation {
  const better = KPI_BY_CODE[code]?.higherIsBetter ?? true;
  if (goal === undefined || goal <= 0) return { actual, goal, target: undefined, pct: undefined, status: "none" };
  if (isVolume(code)) {
    const target = goal * mp.share;
    const a = actual ?? 0;
    const pct = better ? a / target : a > 0 ? target / a : 2;
    return {
      actual: a, goal, target, pct, status: statusOf(pct),
      projected: mp.share > 0 ? a / mp.share : undefined,
      neededPerDay: mp.daysLeft > 0 ? Math.max(0, (goal - a) / mp.daysLeft) : undefined,
    };
  }
  if (actual === undefined) return { actual, goal, target: goal, pct: undefined, status: "none" };
  const pct = better ? actual / goal : actual > 0 ? goal / actual : 2;
  return { actual, goal, target: goal, pct, status: statusOf(pct) };
}

export const STATUS_LABEL: Record<Status, string> = {
  ahead: "▲ Way ahead", on: "✔ On target", close: "● Close", behind: "▼ Behind", none: "No goal",
};
export const STATUS_CLASS: Record<Status, string> = {
  ahead: "bg-blue-50 text-blue-700", on: "bg-green-50 text-green-700", close: "bg-orange-50 text-orange-700",
  behind: "bg-red-50 text-red-700", none: "text-gray-400",
};
export const STATUS_BAR: Record<Status, string> = {
  ahead: "#2563eb", on: "#16a34a", close: "#ea580c", behind: "#dc2626", none: "#d1d5db",
};
