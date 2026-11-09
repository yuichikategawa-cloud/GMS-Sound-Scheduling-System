/// <reference lib="deno.ns" />

import { buildScheduleCsv } from "../../src/features/schedule/services/scheduleCsv.ts";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(message + "\nExpected: " + String(expected) + "\nActual: " + String(actual));
  }
}

const roles = ["FOH", "Monitor", "Assistant"];
const shortTime = (value: string) => value?.slice(0, 5) ?? "";

Deno.test("Schedule CSV supports both historical relation rows and mapped workspace rows", () => {
  const csv = buildScheduleCsv([
    {
      service_date: "2026-11-08",
      locations: { name: "North, Campus" },
      service_name: "Sunday \"Celebration\"",
      start_time: "09:00:00",
      end_time: "11:00:00",
      assignments: [
        { role: "FOH", servants: { full_name: "Ada \"A\"" } },
        { role: "Assistant", servants: { full_name: "Chen" } },
      ],
    },
    {
      service_date: "2026-11-15",
      location_name: "South Campus",
      service_name: "Sunday Service",
      start_time: "16:00:00",
      end_time: "18:00:00",
      assignments: [
        { role: "Monitor", servant_name: "Budi" },
      ],
    },
  ], roles, shortTime);

  assertEqual(
    csv,
    "date,location,service,start,end,FOH,Monitor,Assistant\r\n" +
      "\"2026-11-08\",\"North, Campus\",\"Sunday \"\"Celebration\"\"\",\"09:00\",\"11:00\",\"Ada \"\"A\"\"\",\"\",\"Chen\"\r\n" +
      "\"2026-11-15\",\"South Campus\",\"Sunday Service\",\"16:00\",\"18:00\",\"\",\"Budi\",\"\"",
    "Schedule CSV must preserve column order, time formatting, relation mapping, and quote escaping.",
  );
});

Deno.test("Schedule CSV with no rows contains the stable role-aware header", () => {
  assertEqual(
    buildScheduleCsv([], roles, shortTime),
    "date,location,service,start,end,FOH,Monitor,Assistant",
    "An empty Schedule CSV must retain the existing header row.",
  );
});

Deno.test("Schedule CSV leaves missing assignments and location fields empty", () => {
  const csv = buildScheduleCsv([{
    service_date: "2026-11-22",
    service_name: "Prayer",
    start_time: "07:00",
    end_time: "08:00",
  }], roles, shortTime);

  assertEqual(
    csv,
    "date,location,service,start,end,FOH,Monitor,Assistant\r\n" +
      "\"2026-11-22\",\"\",\"Prayer\",\"07:00\",\"08:00\",\"\",\"\",\"\"",
    "Missing location and assignment values must serialize as empty CSV cells.",
  );
});
