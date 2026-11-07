import { useMemo, useState } from "react";
import type { ScheduleView } from "../../../types";
import { today } from "../../../shared/formatters";

export type CalendarView = "week" | "month";
export type AdminScheduleView = "overview" | "assignments" | "calendar";

export function useScheduleWorkspace({
  schedules,
  myServantId
}: {
  schedules: ScheduleView[];
  isAdmin: boolean;
  myServantId?: string;
}) {
  const [calendarView, setCalendarView] = useState<CalendarView>("week");
  const [adminScheduleView, setAdminScheduleView] = useState<AdminScheduleView>("overview");
  const [personFilter, setPersonFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const myPublishedSchedules = useMemo(
    () => myServantId
      ? schedules.filter(schedule =>
          schedule.status === "published" &&
          schedule.assignments.some(assignment => assignment.servant_id === myServantId)
        )
      : [],
    [schedules, myServantId]
  );
  const thirtyDaysAgoForMyStats = new Date(Date.now() - 30 * 86400000).toLocaleDateString("en-CA");
  const myDaysServed = new Set(
    myPublishedSchedules
      .filter(schedule => schedule.service_date >= thirtyDaysAgoForMyStats && schedule.service_date < today())
      .map(schedule => schedule.service_date)
  ).size;
  const nextMySchedule = [...myPublishedSchedules]
    .filter(schedule => schedule.service_date >= today())
    .sort((a, b) => a.service_date.localeCompare(b.service_date) || a.start_time.localeCompare(b.start_time))[0] ?? null;
  const myUpcomingSchedules = [...myPublishedSchedules]
    .filter(schedule => schedule.service_date >= today())
    .sort((a, b) => a.service_date.localeCompare(b.service_date) || a.start_time.localeCompare(b.start_time));

  const filtered = useMemo(() => {
    const query = personFilter.trim().toLowerCase();
    return schedules.filter(schedule =>
      schedule.service_date >= today() &&
      schedule.status === "published" &&
      (!query || schedule.assignments.some(assignment => assignment.servant_name.toLowerCase().includes(query))) &&
      (!locationFilter || schedule.location_id === locationFilter) &&
      (!serviceFilter || schedule.service_name === serviceFilter) &&
      (!fromDate || schedule.service_date >= fromDate) &&
      (!toDate || schedule.service_date <= toDate)
    );
  }, [schedules, personFilter, locationFilter, serviceFilter, fromDate, toDate]);

  const dailyGroups = useMemo(() => {
    const groups = new Map<string, ScheduleView[]>();
    for (const item of filtered) {
      const current = groups.get(item.service_date) ?? [];
      current.push(item);
      groups.set(item.service_date, current);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, items]) => ({ date, items }));
  }, [filtered]);

  const calendarSections = useMemo(() => {
    const buckets = new Map<string, { key: string; label: string; groups: typeof dailyGroups }>();
    for (const group of dailyGroups) {
      const date = new Date(`${group.date}T12:00:00`);
      let key: string;
      let label: string;
      if (calendarView === "month") {
        key = group.date.slice(0, 7);
        label = date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      } else {
        const monday = new Date(date);
        monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
        key = monday.toLocaleDateString("en-CA");
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        label = `Week of ${monday.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${sunday.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
      }
      const existing = buckets.get(key) ?? { key, label, groups: [] };
      existing.groups.push(group);
      buckets.set(key, existing);
    }
    return [...buckets.values()];
  }, [dailyGroups, calendarView]);

  return {
    calendarView, setCalendarView,
    adminScheduleView, setAdminScheduleView,
    personFilter, setPersonFilter,
    locationFilter, setLocationFilter,
    serviceFilter, setServiceFilter,
    fromDate, setFromDate,
    toDate, setToDate,
    myPublishedSchedules, myDaysServed, nextMySchedule,
    myUpcomingSchedules, filtered, dailyGroups, calendarSections
  };
}

export type ScheduleWorkspaceState = ReturnType<typeof useScheduleWorkspace>;
