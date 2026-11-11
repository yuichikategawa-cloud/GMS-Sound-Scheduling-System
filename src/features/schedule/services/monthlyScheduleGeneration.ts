import type { Role, ScheduleView, ServiceTemplate } from "../../../types.ts";

export type MonthlyScheduleStatus = "new" | "draft" | "published";
export type MonthlyScheduleBlockReason = "published" | "pending_request" | "preexisting_conflict";

export type MonthlyScheduleSlotAssignment = {
  id?: string;
  role: Role;
  servant_id: string;
  servant_name: string;
  confirmation_status?: string;
  preview_manual?: boolean;
};

export type MonthlyScheduleSlot = {
  key: string;
  template_id: string;
  schedule_id: string | null;
  service_date: string;
  location_id: string;
  service_name: string;
  start_time: string;
  end_time: string;
  status: MonthlyScheduleStatus;
  assignments: MonthlyScheduleSlotAssignment[];
  blocked_reason: MonthlyScheduleBlockReason | null;
};

export type MonthlyScheduleGenerationInput = {
  month: string;
  locationIds: readonly string[];
  templates: readonly ServiceTemplate[];
  existingSchedules: readonly ScheduleView[];
  pendingRequestScheduleIds?: readonly string[];
  dataErrors?: readonly string[];
};

export type MonthlyScheduleGenerationResult =
  | {
      ok: true;
      slots: MonthlyScheduleSlot[];
      selectedTemplateCount: number;
      weekendCount: number;
      warnings: string[];
    }
  | {
      ok: false;
      reason:
        | "invalid_month"
        | "select_location"
        | "data_unavailable"
        | "no_weekend_templates"
        | "duplicate_existing_slot";
      errors?: string[];
    };

function isValidMonth(value: string): boolean {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  return Boolean(match && Number(match[1]) >= 2000 && Number(match[1]) <= 9999);
}

function localDateKey(year: number, monthIndex: number, day: number): string {
  const value = new Date(year, monthIndex, day, 12, 0, 0, 0);
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

function naturalKey(date: string, locationId: string, serviceName: string): string {
  return date + "|" + locationId + "|" + serviceName.trim();
}

function getWeekendStart(date: string): string {
  const parts = date.split("-").map(Number);
  const value = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
  const day = value.getDay();
  value.setDate(value.getDate() - (day === 0 ? 1 : 0));
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Builds the selected month's weekend service slots from active templates.
 *
 * Existing slots are reused by the same natural key as the schedules table.
 * Existing assignments are copied unchanged and are treated as locked by the
 * optimizer. Published slots and slots with unresolved requests are marked
 * blocked so the generator cannot alter them.
 *
 * This function performs no I/O and does not mutate its input collections.
 */
export function buildMonthlyScheduleSlots(
  input: MonthlyScheduleGenerationInput,
): MonthlyScheduleGenerationResult {
  if (!isValidMonth(input.month)) {
    return { ok: false, reason: "invalid_month" };
  }

  const errors = (input.dataErrors ?? []).filter(Boolean);
  if (errors.length) {
    return { ok: false, reason: "data_unavailable", errors };
  }

  const locationIds = new Set(input.locationIds.filter(Boolean));
  if (!locationIds.size) {
    return { ok: false, reason: "select_location" };
  }

  const templates = input.templates.filter((template) => {
    const day = Number(template.day_of_week);
    return template.active !== false &&
      locationIds.has(template.location_id) &&
      (day === 0 || day === 6);
  });

  if (!templates.length) {
    return { ok: false, reason: "no_weekend_templates" };
  }

  const [year, monthNumber] = input.month.split("-").map(Number);
  const monthIndex = monthNumber - 1;
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const existingByKey = new Map<string, ScheduleView>();
  const duplicateKeys = new Set<string>();

  for (const schedule of input.existingSchedules) {
    if (!locationIds.has(schedule.location_id) || !schedule.service_date.startsWith(input.month)) {
      continue;
    }
    const key = naturalKey(schedule.service_date, schedule.location_id, schedule.service_name);
    if (existingByKey.has(key)) duplicateKeys.add(key);
    else existingByKey.set(key, schedule);
  }

  if (duplicateKeys.size) {
    return {
      ok: false,
      reason: "duplicate_existing_slot",
      errors: [...duplicateKeys].sort(),
    };
  }

  const pendingIds = new Set(input.pendingRequestScheduleIds ?? []);
  const slots: MonthlyScheduleSlot[] = [];
  const selectedTemplateKeys = new Set<string>();

  for (let day = 1; day <= daysInMonth; day += 1) {
    const serviceDate = localDateKey(year, monthIndex, day);
    const weekday = new Date(year, monthIndex, day, 12, 0, 0, 0).getDay();
    if (weekday !== 0 && weekday !== 6) continue;

    for (const template of templates) {
      if (Number(template.day_of_week) !== weekday) continue;
      selectedTemplateKeys.add(String(template.id));

      const key = naturalKey(serviceDate, template.location_id, template.service_name);
      const existing = existingByKey.get(key);
      const scheduleId = existing?.id ?? null;
      const blockedReason: MonthlyScheduleBlockReason | null =
        existing?.status === "published"
          ? "published"
          : scheduleId && pendingIds.has(scheduleId)
          ? "pending_request"
          : null;

      slots.push({
        key,
        template_id: template.id,
        schedule_id: scheduleId,
        service_date: serviceDate,
        location_id: template.location_id,
        service_name: template.service_name,
        start_time: existing?.start_time ?? template.start_time,
        end_time: existing?.end_time ?? template.end_time,
        status: existing ? existing.status ?? "draft" : "new",
        assignments: (existing?.assignments ?? []).map((assignment) => ({
          ...(assignment.id ? { id: assignment.id } : {}),
          role: assignment.role,
          servant_id: assignment.servant_id,
          servant_name: assignment.servant_name,
          ...(assignment.confirmation_status
            ? { confirmation_status: assignment.confirmation_status }
            : {}),
        })),
        blocked_reason: blockedReason,
      });
    }
  }

  if (!slots.length) {
    return { ok: false, reason: "no_weekend_templates" };
  }

  const weekendCount = new Set(slots.map((slot) => getWeekendStart(slot.service_date))).size;
  const warnings: string[] = [];
  const selectedLocations = new Set(slots.map((slot) => slot.location_id));

  if (selectedLocations.size !== locationIds.size) {
    warnings.push("Some selected locations have no active weekend template in this month.");
  }

  if (slots.some((slot) => slot.blocked_reason === "published")) {
    warnings.push("Published services are preserved and will not receive generated assignments.");
  }

  if (slots.some((slot) => slot.blocked_reason === "pending_request")) {
    warnings.push("Services with unresolved swap or replacement requests are preserved.");
  }

  return {
    ok: true,
    slots,
    selectedTemplateCount: selectedTemplateKeys.size,
    weekendCount,
    warnings,
  };
}
