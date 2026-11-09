import type { Assignment, Location, Schedule, ScheduleView, Servant } from "../../../types";

export function mapSchedules(
  schedules: Schedule[],
  assignments: Assignment[],
  locations: Location[],
  servants: Servant[]
): ScheduleView[] {
  const locationNames = new Map(locations.map(location => [location.id, location.name]));
  const servantNames = new Map(servants.map(servant => [servant.id, servant.full_name]));
  const assignmentsBySchedule = new Map<string, Assignment[]>();

  for (const assignment of assignments) {
    const current = assignmentsBySchedule.get(assignment.schedule_id) ?? [];
    current.push(assignment);
    assignmentsBySchedule.set(assignment.schedule_id, current);
  }

  return schedules.map(schedule => ({
    ...schedule,
    location_name: locationNames.get(schedule.location_id) ?? "Unknown location",
    assignments: (assignmentsBySchedule.get(schedule.id) ?? []).map(assignment => ({
      id: assignment.id,
      role: assignment.role,
      servant_id: assignment.servant_id,
      servant_name: servantNames.get(assignment.servant_id) ?? "Unknown servant",
      confirmation_status: assignment.confirmation_status ?? "pending"
    }))
  }));
}
