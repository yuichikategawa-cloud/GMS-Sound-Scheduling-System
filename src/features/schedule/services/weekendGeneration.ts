export interface WeekendServiceTemplate {
  id: string | number;
  day_of_week: string | number;
  location_id: string;
  service_name: string;
  start_time: string;
  end_time: string;
}

export interface WeekendScheduleRow {
  service_date: string;
  location_id: string;
  service_name: string;
  start_time: string;
  end_time: string;
}

export interface WeekendGenerationInput {
  startDate: string;
  weeks: number;
  templateIds: readonly string[];
  templates: readonly WeekendServiceTemplate[];
}

export type WeekendGenerationResult =
  | {
      ok: true;
      rows: WeekendScheduleRow[];
      selectedTemplateCount: number;
      weekendCount: number;
    }
  | {
      ok: false;
      reason:
        | "invalid_date"
        | "invalid_weeks"
        | "choose_saturday"
        | "select_template"
        | "no_weekend_services";
    };

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Expands a Saturday into Saturday/Sunday dates and maps the selected
 * service templates to schedule rows. It performs no I/O and does not
 * mutate the supplied templates or selection.
 */
export function buildWeekendScheduleRows(
  input: WeekendGenerationInput,
): WeekendGenerationResult {
  const { startDate, weeks, templateIds, templates } = input;

  if (!Number.isSafeInteger(weeks) || weeks < 1) {
    return { ok: false, reason: "invalid_weeks" };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return { ok: false, reason: "invalid_date" };
  }

  const start = new Date(`${startDate}T12:00:00`);
  if (!Number.isFinite(start.getTime()) || formatLocalDate(start) !== startDate) {
    return { ok: false, reason: "invalid_date" };
  }

  if (start.getDay() !== 6) {
    return { ok: false, reason: "choose_saturday" };
  }

  const selectedIds = new Set(templateIds.map(String));
  const selected = templates.filter(template => selectedIds.has(String(template.id)));

  if (!selected.length) {
    return { ok: false, reason: "select_template" };
  }

  const dates: Array<{ date: string; day: number }> = [];
  for (let week = 0; week < weeks; week += 1) {
    const saturday = new Date(start);
    saturday.setDate(start.getDate() + week * 7);

    const sunday = new Date(saturday);
    sunday.setDate(saturday.getDate() + 1);

    dates.push(
      { date: formatLocalDate(saturday), day: 6 },
      { date: formatLocalDate(sunday), day: 0 },
    );
  }

  const rows = dates.flatMap(({ date, day }) =>
    selected
      .filter(template => Number(template.day_of_week) === day)
      .map(template => ({
        service_date: date,
        location_id: template.location_id,
        service_name: template.service_name,
        start_time: template.start_time,
        end_time: template.end_time,
      }))
  );

  if (!rows.length) {
    return { ok: false, reason: "no_weekend_services" };
  }

  return {
    ok: true,
    rows,
    selectedTemplateCount: selected.length,
    weekendCount: weeks,
  };
}
