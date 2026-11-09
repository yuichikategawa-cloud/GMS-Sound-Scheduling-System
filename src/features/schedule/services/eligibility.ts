export type ScheduleRoleSelection = { role: string; id: string };
export type ServingPreferenceRule = {
  servant_id: string; active?: boolean | null; effective_from?: string | null; effective_until?: string | null;
  rule_type: string; days_of_week?: number[] | null; start_time?: string | null; end_time?: string | null;
  location_id?: string | null; service_names?: string[] | null;
};
export type ScheduleEligibilityInput = {
  selected: ScheduleRoleSelection[]; serviceDate: string; locationId: string; serviceName: string;
  startTime: string; endTime: string; preferences: ServingPreferenceRule[];
};
export type ScheduleEligibilityResult = { duplicateServantId: string | null; blockedServantIds: string[] };
export function validateScheduleEligibility(input: ScheduleEligibilityInput): ScheduleEligibilityResult {
  const duplicate = input.selected.find((entry, index) =>
    input.selected.some((other, otherIndex) => otherIndex !== index && other.id === entry.id)
  );
  const weekday = new Date(`${input.serviceDate}T12:00:00`).getDay();
  const blocked = input.selected.filter(entry => {
    const applicable = input.preferences.filter(rule =>
      rule.servant_id === entry.id && rule.active !== false &&
      (!rule.effective_from || rule.effective_from <= input.serviceDate) &&
      (!rule.effective_until || rule.effective_until >= input.serviceDate)
    );
    const timeRules = applicable.filter(rule => rule.rule_type === "allowed_time_window");
    const serviceRules = applicable.filter(rule => rule.rule_type === "allowed_service_scope");
    const timeAllowed = !timeRules.length || timeRules.some(rule =>
      (!rule.days_of_week?.length || rule.days_of_week.includes(weekday)) &&
      input.startTime >= String(rule.start_time).slice(0, 5) &&
      input.endTime <= String(rule.end_time).slice(0, 5)
    );
    const serviceAllowed = !serviceRules.length || serviceRules.some(rule =>
      rule.location_id === input.locationId &&
      (!rule.service_names?.length || rule.service_names.includes(input.serviceName))
    );
    return !timeAllowed || !serviceAllowed;
  }).map(entry => entry.id);
  return { duplicateServantId: duplicate?.id ?? null, blockedServantIds: [...new Set(blocked)] };
}
