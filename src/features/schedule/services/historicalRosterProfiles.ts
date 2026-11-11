import type { Role, Servant } from "../../../types.ts";
import type { MonthlyHistoricalServantProfile } from "./monthlyAssignmentOptimizer.ts";

export type HistoricalRosterProfile = {
  name: string;
  primary_role?: Role;
  manual_only?: boolean;
  role_counts?: Partial<Record<Role, number>>;
  historical_assignments?: number;
  historical_serving_days?: number;
};

export type HistoricalRosterMapping = {
  profiles: MonthlyHistoricalServantProfile[];
  autoAssignmentExcludedServantIds: string[];
  matchedPrimaryRoleNames: string[];
  unmatchedPrimaryRoleNames: string[];
  matchedManualOnlyNames: string[];
  unmatchedManualOnlyNames: string[];
  unmatchedHistoricalNames: string[];
  ambiguousNames: string[];
  ambiguousManualOnlyServantIds: string[];
};

const HISTORY_AS_OF = "2026-11-01";

/** The workbook's April 2025 "GMS Tangerang" entries are the same location as GMS Alam Sutera. */
export const HISTORICAL_LOCATION_ALIASES: Readonly<Record<string, string>> = {
  "GMS Tangerang": "GMS Alam Sutera",
};

export function normalizeHistoricalLocationName(value: string): string {
  const name = value.trim();
  return HISTORICAL_LOCATION_ALIASES[name] ?? name;
}

/**
 * Aggregated from History Sound Serving.xlsx:
 * 1,286 unique service slots between 2025-04-05 and 2026-11-01.
 * "GMS Tangerang" rows from April 2025 are included under the GMS Alam Sutera location alias.
 * Role columns are the source of truth after grouping by date, church,
 * service name and time. Assistant 2 is excluded because GMS currently
 * stores one Assistant role per service.
 *
 * Format: name|FOH count|Monitor count|Assistant 1 count|all role assignments|distinct serving days
 */
const HISTORICAL_WORKLOAD_ROWS = `
Suluh Andrilla|161|2|9|172|59
Yoga|28|7|9|44|19
Joshua Ivannathan|124|6|1|131|49
Kenneth Joshua|49|11|5|65|32
Rudy Go|67|0|0|67|27
Hannah Georgina Alanis|120|7|13|140|61
Christopher Alvino|108|16|3|127|63
Prionggo Hari Sabat|45|28|0|73|26
Andreas|0|0|0|0|0
Jason Ariyanto|83|14|1|98|46
Niko|0|0|0|0|0
Teofilus|0|11|0|11|7
Samuel Hendra Saputra|82|9|6|97|44
Michael Jamestong|93|7|6|106|43
Michael Agung Wijaya Wau|6|75|15|96|47
Hendry Setiawan|56|30|3|89|39
Vincent Luvian|9|54|15|78|42
Jeremy Nathanael|53|36|6|95|53
Erick|0|0|0|0|0
Fransiskus Adrian Lesmana|0|11|74|85|31
Hansel|0|14|13|27|16
David Lifensius|8|75|7|90|41
Dea Esterina|15|36|9|60|40
Habel Putra|41|47|8|96|44
Andrew|13|37|4|54|28
Marvin|15|21|20|56|29
Nicholas Hendra Saputra|0|23|23|46|23
Yutaka Abillasyah|0|28|34|62|29
Meidy Safitri|15|71|27|113|50
Josua Tumpal|0|5|10|15|8
Derent Marcelino Tan|12|16|18|46|31
David Emmanuel Joseph|0|24|30|54|31
Christian Budi|17|41|34|92|39
Affandy Dharma|14|35|35|84|36
Vincentius Jacob|0|21|14|35|28
Tatang Saputra|0|56|47|103|39
Charly Dongan|16|49|26|91|43
Billy Arliman|6|34|32|72|33
David Aquila|0|11|25|36|22
Samuel Soaloon|0|48|37|85|35
Jeremy Anthony|0|14|14|28|17
Aristo Abe Santoso|2|31|30|63|29
Andre Adi Wijaya|10|23|24|57|27
Delbert Bun|9|25|6|40|27
Timothy Rizky|9|45|16|70|27
Nikolas Saputra|0|3|10|13|7
Joe|0|3|16|19|11
Felix Ishakar|0|10|14|24|14
Justin Aditya|0|15|0|15|12
Michael Hansel|0|12|8|20|12
John Wesley|0|9|23|32|16
Kenzo Evander|0|18|3|21|12
Ricky Johannes Hartanto|0|24|8|32|15
Kenny Yosh Yeremia|0|18|13|31|17
David Karel|0|0|0|0|0
Deddy|0|0|0|0|0
Kevin Award|0|0|0|0|0
Michael Nataniel Widodo|0|19|9|28|10
Rivaldo William Suryajaya|0|0|6|6|3
Erik Jonathan|0|0|5|5|2
Cornelius Willsen Nugroho|0|0|4|4|3
`.trim();

const HISTORICAL_PRIMARY_ROLES: Readonly<Record<string, Role>> = {
  "Suluh Andrilla": "FOH",
  "Joshua Ivannathan": "FOH",
  "Kenneth Joshua": "FOH",
  "Rudy Go": "FOH",
  "Hannah Georgina Alanis": "FOH",
  "Christopher Alvino": "FOH",
  "Prionggo Hari Sabat": "FOH",
  "Jason Ariyanto": "FOH",
  "Samuel Hendra Saputra": "FOH",
  "Michael Jamestong": "FOH",
  "Hendry Setiawan": "FOH",
  "Jeremy Nathanael": "FOH",
  "Dea Esterina": "FOH",
  "Habel Putra": "FOH",
  "Michael Agung Wijaya Wau": "Monitor",
  "Vincent Luvian": "Monitor",
  "David Lifensius": "Monitor",
  "Nicholas Hendra Saputra": "Monitor",
  "Yutaka Abillasyah": "Monitor",
  "Meidy Safitri": "Monitor",
  "Derent Marcelino Tan": "Monitor",
  "David Emmanuel Joseph": "Monitor",
  "Christian Budi": "Monitor",
  "Affandy Dharma": "Monitor",
  "Vincentius Jacob": "Monitor",
  "Charly Dongan": "Monitor",
  "Billy Arliman": "Monitor",
  "Samuel Soaloon": "Monitor",
  "Jeremy Anthony": "Monitor",
  "Aristo Abe Santoso": "Monitor",
  "Andre Adi Wijaya": "Monitor",
  "Delbert Bun": "Monitor",
  "Timothy Rizky": "Monitor",
  "Michael Hansel": "Monitor",
  "Ricky Johannes Hartanto": "Monitor",
  "Kenny Yosh Yeremia": "Monitor",
  "Michael Nataniel Widodo": "Monitor",
  "Fransiskus Adrian Lesmana": "Assistant",
  "Tatang Saputra": "Assistant",
  "Justin Aditya": "Assistant",
  "John Wesley": "Assistant",
  "Kenzo Evander": "Assistant",
  "Rivaldo William Suryajaya": "Assistant",
  "Erik Jonathan": "Assistant",
  "Cornelius Willsen Nugroho": "Assistant",
};

const MANUAL_ONLY_NAMES = new Set(["David Karel", "Deddy", "Kevin Award"]);

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function readHistoricalWorkloadRows(): HistoricalRosterProfile[] {
  return HISTORICAL_WORKLOAD_ROWS.split("\n").map((line) => {
    const [name, foh, monitor, assistant, assignments, servingDays] = line.split("|");
    return {
      name,
      ...(HISTORICAL_PRIMARY_ROLES[name]
        ? { primary_role: HISTORICAL_PRIMARY_ROLES[name] }
        : {}),
      role_counts: {
        FOH: Number(foh),
        Monitor: Number(monitor),
        Assistant: Number(assistant),
      },
      historical_assignments: Number(assignments),
      historical_serving_days: Number(servingDays),
    };
  });
}

/**
 * Exact normalized full-name matching only. Spreadsheet row keys are never
 * treated as Supabase servant IDs. No substring or fuzzy matching is allowed.
 *
 * The workbook's inactive color is not imported: Servant.active remains the
 * authoritative live eligibility flag. Manual-only names are excluded from
 * automatic assignment when an unambiguous exact match exists.
 */
export function mapHistoricalRosterProfiles(
  servants: readonly Servant[],
): HistoricalRosterMapping {
  const servantsByName = new Map<string, Servant[]>();
  for (const servant of servants) {
    const key = normalizeName(servant.full_name);
    if (!key) continue;
    const group = servantsByName.get(key) ?? [];
    group.push(servant);
    servantsByName.set(key, group);
  }

  const profiles: MonthlyHistoricalServantProfile[] = [];
  const autoAssignmentExcludedServantIds: string[] = [];
  const matchedPrimaryRoleNames: string[] = [];
  const unmatchedPrimaryRoleNames: string[] = [];
  const matchedManualOnlyNames: string[] = [];
  const unmatchedManualOnlyNames: string[] = [];
  const unmatchedHistoricalNames: string[] = [];
  const ambiguousNames: string[] = [];
  const ambiguousManualOnlyServantIds: string[] = [];

  for (const entry of readHistoricalWorkloadRows()) {
    const matches = servantsByName.get(normalizeName(entry.name)) ?? [];
    const isManualOnly = MANUAL_ONLY_NAMES.has(entry.name);

    if (matches.length !== 1) {
      if (matches.length > 1) {
        ambiguousNames.push(entry.name);
        if (isManualOnly) {
          // If an exact manual-only label matches duplicate live records,
          // exclude every ambiguous match rather than guessing which UUID is correct.
          ambiguousManualOnlyServantIds.push(...matches.map((servant) => servant.id));
        }
      } else if (isManualOnly) unmatchedManualOnlyNames.push(entry.name);
      else {
        unmatchedHistoricalNames.push(entry.name);
        if (entry.primary_role) unmatchedPrimaryRoleNames.push(entry.name);
      }
      continue;
    }

    const servant = matches[0];
    if (isManualOnly) {
      autoAssignmentExcludedServantIds.push(servant.id);
      matchedManualOnlyNames.push(entry.name);
      continue;
    }

    profiles.push({
      servant_id: servant.id,
      ...(entry.primary_role ? { primary_role: entry.primary_role } : {}),
      role_counts: entry.role_counts,
      historical_assignments: entry.historical_assignments,
      historical_serving_days: entry.historical_serving_days,
      history_as_of: HISTORY_AS_OF,
    });
    if (entry.primary_role) matchedPrimaryRoleNames.push(entry.name);
  }

  return {
    profiles,
    autoAssignmentExcludedServantIds: [...new Set([
      ...autoAssignmentExcludedServantIds,
      ...ambiguousManualOnlyServantIds,
    ])].sort(),
    matchedPrimaryRoleNames,
    unmatchedPrimaryRoleNames,
    matchedManualOnlyNames,
    unmatchedManualOnlyNames,
    unmatchedHistoricalNames,
    ambiguousNames,
    ambiguousManualOnlyServantIds: [...new Set(ambiguousManualOnlyServantIds)].sort(),
  };
}
