import type { Role, ScheduleView, Servant } from "../../../types";

export type ServantAssignmentCounts = {
  id: string;
  name: string;
  total: number;
} & Record<Role, number>;

export type LocationAssignmentCount = {
  name: string;
  count: number;
};

export type ServingStatistics = {
  rows: ServantAssignmentCounts[];
  totalAssignments: number;
  filledRequired: number;
  requiredSlots: number;
  requiredRoleGaps: number;
  confirmed: number;
  declined: number;
  confirmationRate: number;
  activeServants: number;
  notScheduled: number;
  locationCounts: LocationAssignmentCount[];
  averageAssignments: number;
  highestWorkload: number;
  lowestWorkload: number;
  fairnessDifference: number;
  showFairnessAlert: boolean;
};

/**
 * Derives the statistics shown for the currently selected schedule range.
 *
 * Preserve the existing dashboard semantics:
 * - servant rows include active servants only;
 * - displayed total assignments are summed from those active-servant rows;
 * - required-role, confirmation, declined, and location metrics use every
 *   assignment row in the selected schedules.
 */
export function calculateServingStatistics(
  schedules: ScheduleView[],
  servants: Servant[],
): ServingStatistics {
  const counts = new Map<string, Record<Role | "total", number>>();

  for (const schedule of schedules) {
    for (const assignment of schedule.assignments) {
      const count = counts.get(assignment.servant_id) ?? {
        total: 0,
        FOH: 0,
        Monitor: 0,
        Assistant: 0,
      };
      count.total++;
      count[assignment.role]++;
      counts.set(assignment.servant_id, count);
    }
  }

  const rows = servants
    .filter(servant => servant.active)
    .map(servant => {
      const count = counts.get(servant.id) ?? {
        total: 0,
        FOH: 0,
        Monitor: 0,
        Assistant: 0,
      };
      return { id: servant.id, name: servant.full_name, ...count };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const totalAssignments = rows.reduce((total, row) => total + row.total, 0);
  const filledRequired = schedules.reduce(
    (total, schedule) =>
      total + schedule.assignments.filter(assignment => assignment.role !== "Assistant").length,
    0,
  );
  const requiredSlots = schedules.length * 2;

  const allAssignments = schedules.flatMap(schedule => schedule.assignments);
  const confirmed = allAssignments.filter(
    assignment => assignment.confirmation_status === "confirmed",
  ).length;
  const declined = allAssignments.filter(
    assignment => assignment.confirmation_status === "declined",
  ).length;
  const confirmationRate = allAssignments.length
    ? Math.round((confirmed / allAssignments.length) * 100)
    : 0;

  const activeServants = servants.filter(servant => servant.active).length;
  const notScheduled = Math.max(
    0,
    activeServants - rows.filter(row => row.total > 0).length,
  );

  const locations = new Map<string, number>();
  for (const schedule of schedules) {
    locations.set(
      schedule.location_name,
      (locations.get(schedule.location_name) ?? 0) + schedule.assignments.length,
    );
  }
  const locationCounts = [...locations.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([name, count]) => ({ name, count }));

  const highestWorkload = rows[0]?.total ?? 0;
  const lowestWorkload = rows.length
    ? Math.min(...rows.map(row => row.total))
    : 0;
  const fairnessDifference = highestWorkload - lowestWorkload;

  return {
    rows,
    totalAssignments,
    filledRequired,
    requiredSlots,
    requiredRoleGaps: Math.max(0, requiredSlots - filledRequired),
    confirmed,
    declined,
    confirmationRate,
    activeServants,
    notScheduled,
    locationCounts,
    averageAssignments: rows.length ? totalAssignments / rows.length : 0,
    highestWorkload,
    lowestWorkload,
    fairnessDifference,
    showFairnessAlert: rows.length > 1 && fairnessDifference >= 3,
  };
}
