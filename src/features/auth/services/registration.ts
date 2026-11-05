export type SignupMetadata = {
  username: string;
  full_name: string;
  email: string;
  gender: string;
  date_of_birth: string;
  nij: string;
  phone_number: string;
  domicile_area: string;
  domicile_other: string;
  cg_category: string;
  cg_status: string;
  cg_number: string;
  cg_days: string[];
  cg_time: string;
  team_leader_name: string;
  coach_name: string;
  cg_leader_name: string;
  leader_phone_numbers: string[];
};

export function buildSignupMetadata(formData: FormData): SignupMetadata {
  const days = formData.getAll("cg_days").map(String);
  if (!days.length) {
    throw new Error("Please select at least one CG day.");
  }

  const leaderPhones = String(formData.get("leader_phone_numbers") || "")
    .split(/[;,\n]/)
    .map(value => value.trim())
    .filter(Boolean);

  const metadata: SignupMetadata = {
    username: String(formData.get("username")).trim().toLowerCase(),
    full_name: String(formData.get("full_name")).trim(),
    email: String(formData.get("email")).trim(),
    gender: String(formData.get("gender")),
    date_of_birth: String(formData.get("date_of_birth")),
    nij: String(formData.get("nij")).trim(),
    phone_number: String(formData.get("phone_number")).trim(),
    domicile_area: String(formData.get("domicile_area")),
    domicile_other: String(formData.get("domicile_other") || ""),
    cg_category: String(formData.get("cg_category")),
    cg_status: String(formData.get("cg_status")),
    cg_number: String(formData.get("cg_number")).trim(),
    cg_days: days,
    cg_time: String(formData.get("cg_time")),
    team_leader_name: String(formData.get("team_leader_name") || ""),
    coach_name: String(formData.get("coach_name") || ""),
    cg_leader_name: String(formData.get("cg_leader_name") || ""),
    leader_phone_numbers: leaderPhones
  };

  if (metadata.domicile_area === "Others" && !metadata.domicile_other.trim()) {
    throw new Error("Please specify your domicile area.");
  }
  if (!leaderPhones.length) {
    throw new Error("Enter at least one leader phone number.");
  }

  if (metadata.cg_status === "Team Leader") metadata.team_leader_name = "";
  if (metadata.cg_status === "Coach") metadata.coach_name = "";
  if (metadata.cg_status === "CG Leader") metadata.cg_leader_name = "";

  return metadata;
}
