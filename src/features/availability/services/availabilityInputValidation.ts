export interface ServingPreferenceInput {
  servantSelected: boolean;
  ruleType: "allowed_time_window" | "allowed_service_scope";
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  locationId: string;
  serviceNames: string[];
}

/** Returns an actionable inline message when a serving-preference form is incomplete. */
export function validateServingPreferenceInput(input: ServingPreferenceInput): string | null {
  if (!input.servantSelected) return "Select a servant before saving this serving preference.";
  if (input.ruleType === "allowed_time_window") {
    if (input.daysOfWeek.length === 0) return "Select at least one allowed day.";
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.startTime) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.endTime) ||
      input.startTime >= input.endTime) {
      return "Choose a valid time window. The end time must be later than the start time.";
    }
    return null;
  }
  if (!input.locationId) return "Choose a church location.";
  if (input.serviceNames.length === 0) return "Select at least one allowed service.";
  return null;
}

/** Validates ISO date-only ranges and returns their inclusive day count. */
export function getInclusiveDateCount(from: string, to: string): number | null {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || to < from) return null;
  const start = Date.parse(from + "T00:00:00Z");
  const end = Date.parse(to + "T00:00:00Z");
  return Math.floor((end - start) / 86400000) + 1;
}
