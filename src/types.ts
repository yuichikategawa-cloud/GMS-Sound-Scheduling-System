export type Role = "FOH" | "Monitor" | "Assistant";
export type Profile = { id: string; display_name: string | null; role: "admin" | "servant" };
export type Location = { id: string; name: string };
export type Servant = { id: string; full_name: string; active: boolean; auth_user_id: string | null };
export type Schedule = {
  id: string; service_date: string; location_id: string; service_name: string;
  start_time: string; end_time: string;
};
export type Assignment = { id: string; schedule_id: string; servant_id: string; role: Role };
export type ScheduleView = Schedule & {
  location_name: string;
  assignments: { role: Role; servant_id: string; servant_name: string }[];
};
