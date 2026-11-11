import type { Role, Servant } from "../../../types.ts";
import type { MonthlyHistoricalServantProfile } from "./monthlyAssignmentOptimizer.ts";

export type HistoricalRosterProfile = {
  name: string;
  primary_role: Role;
  manual_only?: boolean;
};

export type HistoricalRosterMapping = {
  profiles: MonthlyHistoricalServantProfile[];
  autoAssignmentExcludedServantIds: string[];
  matchedPrimaryRoleNames: string[];
  unmatchedPrimaryRoleNames: string[];
  matchedManualOnlyNames: string[];
  unmatchedManualOnlyNames: string[];
  ambiguousNames: string[];
};

const HISTORICAL_ROSTER: readonly HistoricalRosterProfile[] = [
  { name: "Suluh Andrilla", primary_role: "FOH" },
  { name: "Joshua Ivannathan", primary_role: "FOH" },
  { name: "Kenneth Joshua", primary_role: "FOH" },
  { name: "Rudy Go", primary_role: "FOH" },
  { name: "Hannah Georgina Alanis", primary_role: "FOH" },
  { name: "Christopher Alvino", primary_role: "FOH" },
  { name: "Prionggo Hari Sabat", primary_role: "FOH" },
  { name: "Jason Ariyanto", primary_role: "FOH" },
  { name: "Samuel Hendra Saputra", primary_role: "FOH" },
  { name: "Michael Jamestong", primary_role: "FOH" },
  { name: "Hendry Setiawan", primary_role: "FOH" },
  { name: "Jeremy Nathanael", primary_role: "FOH" },
  { name: "Dea Esterina", primary_role: "FOH" },
  { name: "Habel Putra", primary_role: "FOH" },
  { name: "Michael Agung Wijaya Wau", primary_role: "Monitor" },
  { name: "Vincent Luvian", primary_role: "Monitor" },
  { name: "David Lifensius", primary_role: "Monitor" },
  { name: "Nicholas Hendra Saputra", primary_role: "Monitor" },
  { name: "Yutaka Abillasyah", primary_role: "Monitor" },
  { name: "Meidy Safitri", primary_role: "Monitor" },
  { name: "Derent Marcelino Tan", primary_role: "Monitor" },
  { name: "David Emmanuel Joseph", primary_role: "Monitor" },
  { name: "Christian Budi", primary_role: "Monitor" },
  { name: "Affandy Dharma", primary_role: "Monitor" },
  { name: "Vincentius Jacob", primary_role: "Monitor" },
  { name: "Charly Dongan", primary_role: "Monitor" },
  { name: "Billy Arliman", primary_role: "Monitor" },
  { name: "Samuel Soaloon", primary_role: "Monitor" },
  { name: "Jeremy Anthony", primary_role: "Monitor" },
  { name: "Aristo Abe Santoso", primary_role: "Monitor" },
  { name: "Andre Adi Wijaya", primary_role: "Monitor" },
  { name: "Delbert Bun", primary_role: "Monitor" },
  { name: "Timothy Rizky", primary_role: "Monitor" },
  { name: "Michael Hansel", primary_role: "Monitor" },
  { name: "Ricky Johannes Hartanto", primary_role: "Monitor" },
  { name: "Kenny Yosh Yeremia", primary_role: "Monitor" },
  { name: "Michael Nataniel Widodo", primary_role: "Monitor" },
  { name: "Fransiskus Adrian Lesmana", primary_role: "Assistant" },
  { name: "Tatang Saputra", primary_role: "Assistant" },
  { name: "Justin Aditya", primary_role: "Assistant" },
  { name: "John Wesley", primary_role: "Assistant" },
  { name: "Kenzo Evander", primary_role: "Assistant" },
  { name: "Rivaldo William Suryajaya", primary_role: "Assistant" },
  { name: "Erik Jonathan", primary_role: "Assistant" },
  { name: "Cornelius Willsen Nugroho", primary_role: "Assistant" },
  { name: "David Karel", primary_role: "FOH", manual_only: true },
  { name: "Deddy", primary_role: "FOH", manual_only: true },
  { name: "Kevin Award", primary_role: "FOH", manual_only: true },
];

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

/**
 * Maps historical spreadsheet names to the live servant directory using exact
 * normalized full-name matches only. Spreadsheet row keys are deliberately
 * never treated as Supabase servant IDs.
 *
 * The workbook's inactive color is not imported: Servant.active remains the
 * authoritative live eligibility flag. Manual-only names are excluded from
 * automatic selection when an unambiguous exact name match exists.
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
  const ambiguousNames: string[] = [];

  for (const entry of HISTORICAL_ROSTER) {
    const matches = servantsByName.get(normalizeName(entry.name)) ?? [];
    if (matches.length !== 1) {
      if (matches.length > 1) ambiguousNames.push(entry.name);
      else if (entry.manual_only) unmatchedManualOnlyNames.push(entry.name);
      else unmatchedPrimaryRoleNames.push(entry.name);
      continue;
    }

    const servant = matches[0];
    if (entry.manual_only) {
      autoAssignmentExcludedServantIds.push(servant.id);
      matchedManualOnlyNames.push(entry.name);
    } else {
      profiles.push({
        servant_id: servant.id,
        primary_role: entry.primary_role,
      });
      matchedPrimaryRoleNames.push(entry.name);
    }
  }

  return {
    profiles,
    autoAssignmentExcludedServantIds,
    matchedPrimaryRoleNames,
    unmatchedPrimaryRoleNames,
    matchedManualOnlyNames,
    unmatchedManualOnlyNames,
    ambiguousNames,
  };
}
