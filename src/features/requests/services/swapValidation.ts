export interface SwapValidationSchedule {
  id: string;
  service_date: string;
  location_id: string;
  assignments: readonly { servant_id: string }[];
}

/**
 * Finds another-church assignment that conflicts with moving a servant onto
 * the destination date and location. Callers may exclude the two schedules
 * participating in an administrator-approved swap.
 */
export function findCrossLocationAssignmentConflict(
  schedules: readonly SwapValidationSchedule[],
  servantId: string,
  destinationDate: string,
  destinationLocationId: string,
  excludedScheduleIds: readonly string[] = [],
): SwapValidationSchedule | null {
  return schedules.find(schedule =>
    schedule.service_date === destinationDate &&
    schedule.location_id !== destinationLocationId &&
    !excludedScheduleIds.includes(schedule.id) &&
    schedule.assignments.some(assignment => assignment.servant_id === servantId)
  ) ?? null;
}

/** A valid swap must exchange assignments across two distinct service dates. */
export function isCrossDateSwap(sourceDate: string, targetDate: string): boolean {
  return Boolean(sourceDate && targetDate && sourceDate !== targetDate);
}
