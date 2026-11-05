const DAILY_CHURCH_COLORS = ["#405A78", "#5B5076", "#3F665F"] as const;
const DAILY_TEAM_TINTS = [
  "rgba(133,180,211,.085)",
  "rgba(177,155,211,.085)",
  "rgba(137,184,157,.085)",
  "rgba(211,177,125,.085)",
  "rgba(127,174,184,.085)",
  "rgba(197,151,157,.085)"
] as const;

export const DAILY_CATEGORY_TINTS = {
  vss: "rgba(132,177,211,.105)",
  aog: "rgba(174,145,199,.105)"
} as const;

function dailyHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

export function dailyChurchColor(name: string): string {
  const normalized = name.toLowerCase();
  if (normalized.includes("alam sutera")) return DAILY_CHURCH_COLORS[0];
  if (normalized.includes("bsd")) return DAILY_CHURCH_COLORS[1];
  if (normalized.includes("karawaci")) return DAILY_CHURCH_COLORS[2];
  return DAILY_CHURCH_COLORS[dailyHash(normalized) % DAILY_CHURCH_COLORS.length];
}

export function dailyServiceCategory(name: string): "vss" | "aog" | "regular" {
  const normalized = name.trim().toLowerCase();
  if (normalized === "vss" || normalized.startsWith("vss ")) return "vss";
  if (normalized.includes("aog")) return "aog";
  return "regular";
}

export function dailyTeamTint(
  servantId: string | null | undefined,
  servantName: string | undefined
): string | undefined {
  if (!servantId && !servantName) return undefined;
  return DAILY_TEAM_TINTS[dailyHash(servantId || servantName || "") % DAILY_TEAM_TINTS.length];
}
