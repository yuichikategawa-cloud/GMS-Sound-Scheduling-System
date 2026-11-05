import { validateScheduleEligibility, type ServingPreferenceRule } from "../../src/features/schedule/services/eligibility.ts";
function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message + "\nExpected: " + JSON.stringify(expected) + "\nActual: " + JSON.stringify(actual));
}
const base = { serviceDate: "2026-11-08", locationId: "loc-as", serviceName: "Sunday Service", startTime: "09:00", endTime: "11:00" };
Deno.test("schedule eligibility accepts distinct servants when unrestricted", () => {
  const result = validateScheduleEligibility({ ...base, selected: [{role:"FOH",id:"a"},{role:"Monitor",id:"b"}], preferences: [] });
  assertEqual(result, {duplicateServantId:null,blockedServantIds:[]}, "Unrestricted manual selections should pass.");
});
Deno.test("schedule eligibility identifies duplicate servant role selection", () => {
  const result = validateScheduleEligibility({ ...base, selected: [{role:"FOH",id:"a"},{role:"Monitor",id:"a"}], preferences: [] });
  assertEqual(result.duplicateServantId, "a", "The duplicate servant ID should be returned.");
});
Deno.test("time-window preferences enforce weekday and complete service interval", () => {
  const preferences: ServingPreferenceRule[] = [{servant_id:"a",rule_type:"allowed_time_window",days_of_week:[0],start_time:"09:30",end_time:"12:00"}];
  const result = validateScheduleEligibility({ ...base, selected:[{role:"FOH",id:"a"}], preferences });
  assertEqual(result.blockedServantIds, ["a"], "A service starting before the allowed time must be blocked.");
});
Deno.test("service-scope preferences require matching location and service", () => {
  const preferences: ServingPreferenceRule[] = [{servant_id:"a",rule_type:"allowed_service_scope",location_id:"loc-bsd",service_names:["Youth Service"]}];
  const result = validateScheduleEligibility({ ...base, selected:[{role:"FOH",id:"a"}], preferences });
  assertEqual(result.blockedServantIds, ["a"], "A different location and service must be blocked.");
});
Deno.test("inactive and out-of-date preferences do not block selection", () => {
  const preferences: ServingPreferenceRule[] = [
    {servant_id:"a",active:false,rule_type:"allowed_service_scope",location_id:"other"},
    {servant_id:"a",effective_until:"2026-11-07",rule_type:"allowed_service_scope",location_id:"other"},
    {servant_id:"a",effective_from:"2026-11-09",rule_type:"allowed_service_scope",location_id:"other"}
  ];
  const result = validateScheduleEligibility({ ...base, selected:[{role:"FOH",id:"a"}], preferences });
  assertEqual(result.blockedServantIds, [], "Inactive and non-applicable date ranges must be ignored.");
});
Deno.test("matching alternatives within each preference type permit the assignment", () => {
  const preferences: ServingPreferenceRule[] = [
    {servant_id:"a",rule_type:"allowed_time_window",days_of_week:[1],start_time:"09:00",end_time:"11:00"},
    {servant_id:"a",rule_type:"allowed_time_window",days_of_week:[0],start_time:"08:00",end_time:"12:00"},
    {servant_id:"a",rule_type:"allowed_service_scope",location_id:"loc-as",service_names:["Sunday Service"]}
  ];
  const result = validateScheduleEligibility({ ...base, selected:[{role:"FOH",id:"a"}], preferences });
  assertEqual(result.blockedServantIds, [], "Any matching rule within each restriction type should permit the assignment.");
});
