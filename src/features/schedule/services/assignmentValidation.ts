import type { ScheduleView } from "../../../types.ts";
import {
  validateScheduleEligibility,
  type ScheduleRoleSelection,
  type ServingPreferenceRule
} from "./eligibility.ts";

export type AssignmentAvailabilityEntry = {
  servant_id: string;
  service_date: string;
  status: string;
};
export type ScheduleAssignmentConflict = { servantId: string; schedule: ScheduleView };
export type HighWorkloadWarning = { servantId: string; days: number };
export type ScheduleAssignmentValidationInput = {
  selected: ScheduleRoleSelection[];
  serviceDate: string;
  locationId: string;
  serviceName: string;
  startTime: string;
  endTime: string;
  schedules: ScheduleView[];
  availability: AssignmentAvailabilityEntry[];
  preferences: ServingPreferenceRule[];
  editingScheduleId?: string | null;
};
export type ScheduleAssignmentValidationResult = {
  duplicateServantId: string | null;
  blockedServantIds: string[];
  crossChurchConflicts: ScheduleAssignmentConflict[];
  overlappingConflicts: ScheduleAssignmentConflict[];
  unavailableServantIds: string[];
  preferNotServantIds: string[];
  highWorkload: HighWorkloadWarning[];
};
function toMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}
function getThirtyDayCutoff(serviceDate: string): string {
  return new Date(new Date(`${serviceDate}T12:00:00`).getTime() - 30 * 86400000).toLocaleDateString("en-CA");
}
export function validateScheduleAssignment(input: ScheduleAssignmentValidationInput): ScheduleAssignmentValidationResult {
  const eligibility = validateScheduleEligibility({
    selected: input.selected, serviceDate: input.serviceDate, locationId: input.locationId,
    serviceName: input.serviceName, startTime: input.startTime, endTime: input.endTime,
    preferences: input.preferences
  });
  const crossChurchConflicts = input.selected.flatMap(entry => {
    const other = input.schedules.find(schedule =>
      schedule.service_date === input.serviceDate && schedule.location_id !== input.locationId &&
      schedule.id !== input.editingScheduleId &&
      schedule.assignments.some(assignment => assignment.servant_id === entry.id));
    return other ? [{ servantId: entry.id, schedule: other }] : [];
  });
  const overlappingConflicts = input.selected.flatMap(entry => {
    const other = input.schedules.find(schedule =>
      schedule.service_date === input.serviceDate && schedule.location_id === input.locationId &&
      schedule.id !== input.editingScheduleId &&
      schedule.assignments.some(assignment => assignment.servant_id === entry.id) &&
      toMinutes(input.startTime) < toMinutes(schedule.end_time) &&
      toMinutes(input.endTime) > toMinutes(schedule.start_time));
    return other ? [{ servantId: entry.id, schedule: other }] : [];
  });
  const unavailableServantIds = input.selected.filter(entry => input.availability.some(record =>
    record.servant_id === entry.id && record.service_date === input.serviceDate && record.status === "unavailable")).map(entry => entry.id);
  const preferNotServantIds = input.selected.filter(entry => input.availability.some(record =>
    record.servant_id === entry.id && record.service_date === input.serviceDate && record.status === "prefer_not")).map(entry => entry.id);
  const thirtyDayCutoff = getThirtyDayCutoff(input.serviceDate);
  const highWorkload = input.selected.flatMap(entry => {
    const days = new Set(input.schedules.filter(schedule =>
      schedule.service_date < input.serviceDate && schedule.service_date >= thirtyDayCutoff &&
      schedule.assignments.some(assignment => assignment.servant_id === entry.id)
    ).map(schedule => schedule.service_date)).size;
    return days >= 5 ? [{ servantId: entry.id, days }] : [];
  });
  return { duplicateServantId: eligibility.duplicateServantId, blockedServantIds: eligibility.blockedServantIds,
    crossChurchConflicts, overlappingConflicts, unavailableServantIds, preferNotServantIds, highWorkload };
}
