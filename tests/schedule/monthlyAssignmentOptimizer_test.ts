/// <reference lib="deno.ns" />

import {
  getMonthlyAssignmentCandidates,
  optimizeMonthlyAssignments,
  type MonthlyAssignmentOptimizerInput,
} from "../../src/features/schedule/services/monthlyAssignmentOptimizer.ts";
import type { Role, ScheduleView, Servant } from "../../src/types.ts";
import type { MonthlyScheduleSlot } from "../../src/features/schedule/services/monthlyScheduleGeneration.ts";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      message + "\nExpected: " + JSON.stringify(expected) + "\nActual: " + JSON.stringify(actual),
    );
  }
}

function createServant(id: string, active = true): Servant {
  return { id, full_name: id.toUpperCase(), active, auth_user_id: null };
}

function createSlot(
  date: string,
  service: string,
  start: string,
  end: string,
  assignments: Array<{ role: Role; servant_id: string }> = [],
  location = "loc-as",
): MonthlyScheduleSlot {
  const key = date + "|" + location + "|" + service;
  return {
    key,
    schedule_id: null,
    service_date: date,
    location_id: location,
    service_name: service,
    start_time: start,
    end_time: end,
    status: "new",
    assignments: assignments.map((assignment) => ({
      role: assignment.role,
      servant_id: assignment.servant_id,
      servant_name: assignment.servant_id.toUpperCase(),
      confirmation_status: "pending",
    })),
    blocked_reason: null,
  };
}

function createSchedule(
  id: string,
  date: string,
  location: string,
  service: string,
  start: string,
  end: string,
  assigned: Array<{ role: Role; servant_id: string }>,
): ScheduleView {
  return {
    id,
    service_date: date,
    location_id: location,
    service_name: service,
    start_time: start,
    end_time: end,
    status: "draft",
    location_name: location,
    assignments: assigned.map((assignment) => ({
      role: assignment.role,
      servant_id: assignment.servant_id,
      servant_name: assignment.servant_id.toUpperCase(),
      confirmation_status: "pending",
    })),
  };
}

function baseInput(
  slots: MonthlyScheduleSlot[],
  servants: Servant[],
): MonthlyAssignmentOptimizerInput {
  return {
    slots,
    servants,
    availability: [],
    preferences: [],
    schedules: [],
    includeAssistant: false,
  };
}

Deno.test("monthly optimizer treats missing availability as eligible", () => {
  const slot = createSlot("2026-11-08", "Sunday Service", "09:00", "11:00");
  const result = optimizeMonthlyAssignments(baseInput(
    [slot],
    [createServant("servant-a"), createServant("servant-b")],
  ));

  if (!result.ok) throw new Error("Expected generation to succeed.");
  assertEqual(result.assignments.length, 2, "Both required positions should be filled without explicit availability.");
  assertEqual(result.unfilledRequiredPositionCount, 0, "Missing availability must not create a vacancy.");
});

Deno.test("monthly optimizer excludes explicitly unavailable servants", () => {
  const slot = createSlot("2026-11-08", "Sunday Service", "09:00", "11:00", [
    { role: "Monitor", servant_id: "locked-monitor" },
  ]);
  const input = baseInput(
    [slot],
    [createServant("locked-monitor"), createServant("unavailable"), createServant("available")],
  );
  input.availability = [
    { servant_id: "unavailable", service_date: "2026-11-08", status: "unavailable" },
  ];

  const result = optimizeMonthlyAssignments(input);
  if (!result.ok) throw new Error("Expected generation to succeed.");
  assertEqual(result.assignments.map((assignment) => assignment.servant_id), ["available"], "Unavailable servant must never be assigned.");
});

Deno.test("monthly optimizer avoids prefer-not candidates when a reasonable alternative exists", () => {
  const slot = createSlot("2026-11-08", "Sunday Service", "09:00", "11:00", [
    { role: "Monitor", servant_id: "locked-monitor" },
  ]);
  const input = baseInput(
    [slot],
    [createServant("locked-monitor"), createServant("prefer-not"), createServant("available")],
  );
  input.availability = [
    { servant_id: "prefer-not", service_date: "2026-11-08", status: "prefer_not" },
  ];

  const result = optimizeMonthlyAssignments(input);
  if (!result.ok) throw new Error("Expected generation to succeed.");
  assertEqual(result.assignments[0].servant_id, "available", "The normal candidate should be preferred.");
  assertEqual(result.warnings.length, 0, "No warning is needed when prefer-not is avoided.");
});

Deno.test("monthly optimizer can use prefer-not as a visible fallback when no alternative exists", () => {
  const slot = createSlot("2026-11-08", "Sunday Service", "09:00", "11:00", [
    { role: "Monitor", servant_id: "locked-monitor" },
  ]);
  const input = baseInput(
    [slot],
    [createServant("locked-monitor"), createServant("prefer-not")],
  );
  input.availability = [
    { servant_id: "prefer-not", service_date: "2026-11-08", status: "prefer_not" },
  ];

  const result = optimizeMonthlyAssignments(input);
  if (!result.ok) throw new Error("Expected generation to succeed.");
  assertEqual(result.assignments[0].servant_id, "prefer-not", "Prefer-not must remain a soft restriction.");
  assertEqual(result.preferNotWarnings.length, 1, "The use of prefer-not must be disclosed separately from operational warnings.");
});

Deno.test("monthly optimizer preserves existing assignments and only fills vacant roles", () => {
  const slot = createSlot("2026-11-08", "Sunday Service", "09:00", "11:00", [
    { role: "FOH", servant_id: "locked-foh" },
  ]);
  const input = baseInput(
    [slot],
    [createServant("locked-foh"), createServant("monitor-candidate")],
  );

  const result = optimizeMonthlyAssignments(input);
  if (!result.ok) throw new Error("Expected generation to succeed.");
  assertEqual(result.lockedAssignmentCount, 1, "Existing assignment must be counted as locked.");
  assertEqual(result.assignments.map((assignment) => assignment.role), ["Monitor"], "Only the vacant Monitor role may be generated.");
  assertEqual(result.assignments.some((assignment) => assignment.servant_id === "locked-foh"), false, "Existing servant must not be moved or reused in the same service.");
});

Deno.test("monthly optimizer blocks a servant already committed at another church on the same day", () => {
  const slot = createSlot("2026-11-08", "Sunday Service", "09:00", "11:00", [
    { role: "Monitor", servant_id: "locked-monitor" },
  ]);
  const schedules = [
    createSchedule("bsd-existing", "2026-11-08", "loc-bsd", "BSD Service", "17:00", "19:00", [
      { role: "FOH", servant_id: "cross-church" },
    ]),
  ];
  const input = {
    ...baseInput([slot], [
      createServant("locked-monitor"),
      createServant("cross-church"),
      createServant("local-candidate"),
    ]),
    schedules,
  };

  const result = optimizeMonthlyAssignments(input);
  if (!result.ok) throw new Error("Expected generation to succeed.");
  assertEqual(result.assignments[0].servant_id, "local-candidate", "Different church assignment must block the candidate regardless of time.");
});

Deno.test("monthly optimizer blocks overlapping services at the same church", () => {
  const slot = createSlot("2026-11-08", "Sunday Service", "10:00", "12:00", [
    { role: "Monitor", servant_id: "locked-monitor" },
  ]);
  const schedules = [
    createSchedule("overlap", "2026-11-08", "loc-as", "Earlier Service", "09:00", "11:00", [
      { role: "FOH", servant_id: "overlapping-candidate" },
    ]),
  ];
  const input = {
    ...baseInput([slot], [
      createServant("locked-monitor"),
      createServant("overlapping-candidate"),
      createServant("safe-candidate"),
    ]),
    schedules,
  };

  const result = optimizeMonthlyAssignments(input);
  if (!result.ok) throw new Error("Expected generation to succeed.");
  assertEqual(result.assignments[0].servant_id, "safe-candidate", "Overlapping service must block the candidate.");
});

Deno.test("monthly optimizer permits adjacent same-church services", () => {
  const slot = createSlot("2026-11-08", "Next Service", "11:00", "13:00", [
    { role: "Monitor", servant_id: "locked-monitor" },
  ]);
  const schedules = [
    createSchedule("adjacent", "2026-11-08", "loc-as", "Earlier Service", "09:00", "11:00", [
      { role: "FOH", servant_id: "candidate" },
    ]),
  ];
  const input = { ...baseInput([slot], [createServant("locked-monitor"), createServant("candidate")]), schedules };

  const result = optimizeMonthlyAssignments(input);
  if (!result.ok) throw new Error("Expected generation to succeed.");
  assertEqual(result.assignments[0].servant_id, "candidate", "A service beginning at the prior service's end time is allowed.");
});

Deno.test("monthly optimizer applies saved time and service-scope restrictions as hard constraints", () => {
  const slot = createSlot("2026-11-08", "Sunday Service", "09:00", "11:00", [
    { role: "Monitor", servant_id: "locked-monitor" },
  ]);
  const input = baseInput(
    [slot],
    [createServant("locked-monitor"), createServant("restricted"), createServant("permitted")],
  );
  input.preferences = [
    {
      servant_id: "restricted",
      active: true,
      rule_type: "allowed_service_scope",
      location_id: "loc-bsd",
      service_names: ["BSD Service"],
    },
  ];

  const result = optimizeMonthlyAssignments(input);
  if (!result.ok) throw new Error("Expected generation to succeed.");
  assertEqual(result.assignments[0].servant_id, "permitted", "A servant outside saved service scope must not be selected.");
});

Deno.test("monthly optimizer assigns constrained positions before positions with more candidates", () => {
  const slots = [
    createSlot("2026-11-07", "Service 1", "09:00", "11:00", [
      { role: "Monitor", servant_id: "monitor-1" },
    ]),
    createSlot("2026-11-08", "Service 2", "09:00", "11:00", [
      { role: "Monitor", servant_id: "monitor-2" },
    ]),
  ];
  const input = baseInput(
    slots,
    [
      createServant("monitor-1"),
      createServant("monitor-2"),
      createServant("flexible"),
      createServant("service-one-only"),
    ],
  );
  input.preferences = [
    {
      servant_id: "service-one-only",
      active: true,
      rule_type: "allowed_service_scope",
      location_id: "loc-as",
      service_names: ["Service 1"],
    },
  ];

  const result = optimizeMonthlyAssignments(input);
  if (!result.ok) throw new Error("Expected generation to succeed.");
  const serviceOne = result.assignments.find((assignment) => assignment.service_name === "Service 1");
  const serviceTwo = result.assignments.find((assignment) => assignment.service_name === "Service 2");
  assertEqual(serviceTwo?.servant_id, "flexible", "The flexible candidate should be reserved for the less constrained position.");
  assertEqual(serviceOne?.servant_id, "service-one-only", "The only eligible candidate should fill their constrained position.");
});

Deno.test("monthly optimizer uses historical primary-role preference as a soft ranking signal", () => {
  const slot = createSlot("2026-11-08", "Sunday Service", "09:00", "11:00", [
    { role: "Monitor", servant_id: "locked-monitor" },
  ]);
  const input = baseInput(
    [slot],
    [createServant("locked-monitor"), createServant("a-general"), createServant("z-foh")],
  );
  input.historicalProfiles = [
    { servant_id: "z-foh", primary_role: "FOH", role_counts: { FOH: 4 } },
    { servant_id: "a-general", primary_role: "Monitor", role_counts: { Monitor: 4 } },
  ];

  const result = optimizeMonthlyAssignments(input);
  if (!result.ok) throw new Error("Expected generation to succeed.");
  assertEqual(result.assignments[0].servant_id, "z-foh", "Primary role familiarity should outweigh a stable ID tie-break.");
});

Deno.test("monthly optimizer counts practical service opportunities once per service, not once per role", () => {
  const slots = [
    createSlot("2026-11-07", "Service 1", "09:00", "11:00", [
      { role: "Monitor", servant_id: "monitor-1" },
    ]),
    createSlot("2026-11-08", "Service 2", "09:00", "11:00", [
      { role: "Monitor", servant_id: "monitor-2" },
    ]),
  ];
  const input = baseInput(
    slots,
    [
      createServant("monitor-1"),
      createServant("monitor-2"),
      createServant("flexible"),
      createServant("service-one-only"),
    ],
  );
  input.preferences = [{
    servant_id: "service-one-only",
    active: true,
    rule_type: "allowed_service_scope",
    location_id: "loc-as",
    service_names: ["Service 1"],
  }];

  const result = optimizeMonthlyAssignments(input);
  if (!result.ok) throw new Error("Expected generation to succeed.");
  const flexible = result.workloads.find((item) => item.servant_id === "flexible");
  const constrained = result.workloads.find((item) => item.servant_id === "service-one-only");
  assertEqual(flexible?.eligible_opportunities, 2, "Flexible servant has two unique service opportunities.");
  assertEqual(constrained?.eligible_opportunities, 1, "Constrained servant has one unique service opportunity.");
});

Deno.test("monthly optimizer treats Assistant as optional and can omit it", () => {
  const slot = createSlot("2026-11-08", "Sunday Service", "09:00", "11:00", [
    { role: "FOH", servant_id: "locked-foh" },
    { role: "Monitor", servant_id: "locked-monitor" },
  ]);
  const servants = [createServant("locked-foh"), createServant("locked-monitor"), createServant("assistant")];

  const omitted = optimizeMonthlyAssignments({ ...baseInput([slot], servants), includeAssistant: false });
  if (!omitted.ok) throw new Error("Expected generation to succeed.");
  assertEqual(omitted.assignments.length, 0, "Assistant is not generated when disabled.");
  assertEqual(omitted.unfilledRequiredPositionCount, 0, "Optional Assistant does not create a required gap.");

  const included = optimizeMonthlyAssignments({ ...baseInput([slot], servants), includeAssistant: true });
  if (!included.ok) throw new Error("Expected generation to succeed.");
  assertEqual(included.assignments.map((assignment) => assignment.role), ["Assistant"], "Assistant is generated when enabled and eligible.");
});

Deno.test("monthly optimizer stops when an availability or preference read failed", () => {
  const result = optimizeMonthlyAssignments({
    ...baseInput([createSlot("2026-11-08", "Sunday Service", "09:00", "11:00")], [createServant("a"), createServant("b")]),
    dataErrors: ["Availability query failed."],
  });

  assertEqual(result, {
    ok: false,
    reason: "data_unavailable",
    errors: ["Availability query failed."],
  }, "A failed data read must fail closed.");
});

Deno.test("monthly optimizer excludes manual-only servants from automatic allocation", () => {
  const slot = createSlot("2026-11-08", "Sunday Service", "09:00", "11:00", [
    { role: "Monitor", servant_id: "locked-monitor" },
  ]);
  const input = baseInput(
    [slot],
    [createServant("locked-monitor"), createServant("manual-only"), createServant("automatic")],
  );
  input.autoAssignmentExcludedServantIds = ["manual-only"];

  const result = optimizeMonthlyAssignments(input);
  if (!result.ok) throw new Error("Expected generation to succeed.");
  assertEqual(result.assignments[0].servant_id, "automatic", "Manual-only servants must remain available for manual selection but not auto-assignment.");
});

Deno.test("monthly optimizer distinguishes manual-only roster entries from an inactive roster", () => {
  const slot = createSlot("2026-11-08", "Sunday Service", "09:00", "11:00");
  const manualOnly = optimizeMonthlyAssignments({
    ...baseInput([slot], [createServant("manual-a"), createServant("manual-b")]),
    autoAssignmentExcludedServantIds: ["manual-a", "manual-b"],
  });
  if (!manualOnly.ok) throw new Error("Expected a reviewable partial result.");
  assertEqual(manualOnly.unfilledPositions.map((position) => position.reason), ["no_auto_assignable_servants", "no_auto_assignable_servants"], "Active manual-only servants must not be reported as inactive.");

  const inactive = optimizeMonthlyAssignments(baseInput(
    [slot],
    [createServant("inactive-a", false), createServant("inactive-b", false)],
  ));
  if (!inactive.ok) throw new Error("Expected a reviewable partial result.");
  assertEqual(inactive.unfilledPositions.map((position) => position.reason), ["no_active_servants", "no_active_servants"], "An all-inactive roster must be identified separately.");
});

Deno.test("monthly optimizer freezes a service when a preserved assignment already violates a hard conflict", () => {
  const slot = createSlot("2026-11-08", "Sunday Service", "09:00", "11:00", [
    { role: "FOH", servant_id: "cross-church-servant" },
  ]);
  const schedules = [
    createSchedule("bsd-existing", "2026-11-08", "loc-bsd", "BSD Service", "17:00", "19:00", [
      { role: "Monitor", servant_id: "cross-church-servant" },
    ]),
  ];
  const input = {
    ...baseInput([slot], [
      createServant("cross-church-servant"),
      createServant("otherwise-eligible"),
    ]),
    schedules,
  };

  const result = optimizeMonthlyAssignments(input);
  if (!result.ok) throw new Error("Expected a reviewable partial result.");
  assertEqual(result.assignments.length, 0, "A slot with an existing hard conflict must be frozen.");
  assertEqual(result.unfilledPositions.map((position) => position.reason), ["preexisting_conflict"], "The vacancy should explain why the service was frozen.");
  assertEqual(result.skippedServiceCount, 1, "The frozen service should be counted as skipped.");
});

Deno.test("monthly optimizer uses the historical workbook as a low-weight long-term workload signal", () => {
  const slot = createSlot("2026-11-08", "Sunday Service", "09:00", "11:00", [
    { role: "Monitor", servant_id: "locked-monitor" },
  ]);
  const input = baseInput(
    [slot],
    [createServant("locked-monitor"), createServant("high-history"), createServant("low-history")],
  );
  input.historicalProfiles = [
    {
      servant_id: "high-history",
      primary_role: "FOH",
      role_counts: { FOH: 80 },
      historical_assignments: 172,
      historical_serving_days: 59,
      history_as_of: "2026-11-01",
    },
    {
      servant_id: "low-history",
      primary_role: "FOH",
      role_counts: { FOH: 10 },
      historical_assignments: 10,
      historical_serving_days: 5,
      history_as_of: "2026-11-01",
    },
  ];

  const result = optimizeMonthlyAssignments(input);
  if (!result.ok) throw new Error("Expected generation to succeed.");
  assertEqual(result.assignments[0].servant_id, "low-history", "A lower long-term historic workload should be preferred when all current constraints and recent workload are equal.");
  const high = result.workloads.find((workload) => workload.servant_id === "high-history");
  assertEqual(high?.historical_assignments, 172, "The preview should surface the historical assignment baseline.");
  assertEqual(high?.historical_serving_days, 59, "The preview should surface distinct historical serving days.");
});

Deno.test("monthly optimizer preserves declined assignments but reports them as uncovered and excludes them from workload", () => {
  const slot = createSlot("2026-11-08", "Sunday Service", "09:00", "11:00", [
    { role: "FOH", servant_id: "declined-servant" },
    { role: "Monitor", servant_id: "pending-servant" },
  ]);
  slot.assignments[0].confirmation_status = "declined";
  slot.assignments[1].confirmation_status = "pending";

  const result = optimizeMonthlyAssignments(baseInput(
    [slot],
    [createServant("declined-servant"), createServant("pending-servant"), createServant("otherwise-free")],
  ));
  if (!result.ok) throw new Error("Expected generation to succeed.");
  assertEqual(result.assignments.length, 0, "Existing declined role rows are preserved and not automatically replaced.");
  assertEqual(result.lockedAssignmentCount, 2, "Both existing role rows remain preserved.");
  assertEqual(result.declinedAssignmentCount, 1, "The declined commitment must be counted separately.");
  assertEqual(result.filledRequiredPositionCount, 1, "A declined assignment is not considered covered.");
  assertEqual(result.unfilledRequiredPositionCount, 1, "A declined required assignment remains a manual-review gap.");
  assertEqual(result.unfilledPositions[0].reason, "declined_assignment", "The preview must explain the declined role.");
  assertEqual(result.workloads.some((workload) => workload.servant_id === "declined-servant"), false, "Declined assignment is excluded from workload.");
});

Deno.test("monthly optimizer avoids assigning the same servant on both days of a weekend when an alternative exists", () => {
  const slot = createSlot("2026-11-08", "Sunday Service", "09:00", "11:00", [
    { role: "Monitor", servant_id: "locked-monitor" },
  ]);
  const schedules = [
    createSchedule("saturday-existing", "2026-11-07", "loc-as", "Saturday Service", "16:00", "18:00", [
      { role: "FOH", servant_id: "served-saturday" },
    ]),
  ];
  const result = optimizeMonthlyAssignments({
    ...baseInput([slot], [
      createServant("locked-monitor"),
      createServant("served-saturday"),
      createServant("fresh-weekend"),
    ]),
    schedules,
  });

  if (!result.ok) throw new Error("Expected generation to succeed.");
  assertEqual(result.assignments[0].servant_id, "fresh-weekend", "A fresh candidate should be preferred over a servant already assigned Saturday.");
});

Deno.test("monthly workload history excludes declined assignments from the recent 60-day display", () => {
  const slot = createSlot("2026-11-08", "Sunday Service", "09:00", "11:00", [
    { role: "Monitor", servant_id: "locked-monitor" },
  ]);
  const oldDeclined = createSchedule("declined-old", "2026-10-25", "loc-as", "Prior Service", "09:00", "11:00", [
    { role: "FOH", servant_id: "declined-servant" },
  ]);
  oldDeclined.assignments[0].confirmation_status = "declined";

  const result = optimizeMonthlyAssignments({
    ...baseInput([slot], [
      createServant("locked-foh"),
      createServant("locked-monitor"),
      createServant("declined-servant"),
    ]),
    schedules: [oldDeclined],
  });

  if (!result.ok) throw new Error("Expected generation to succeed.");
  const workload = result.workloads.find((item) => item.servant_id === "declined-servant");
  assertEqual(workload?.recent_60_day_assignments, 0, "Declined assignments must not inflate recent workload.");
  assertEqual(workload?.recent_60_day_days, 0, "Declined assignments must not count as recent serving days.");
});

Deno.test("monthly fairness counts preserved existing service assignments as practical opportunities", () => {
  const slot = createSlot("2026-11-15", "New Service", "09:00", "11:00", [
    { role: "Monitor", servant_id: "locked-monitor" },
  ]);
  const publishedHistory = createSchedule(
    "published-history",
    "2026-11-01",
    "loc-as",
    "Earlier Published Service",
    "09:00",
    "11:00",
    [{ role: "FOH", servant_id: "history-servant" }],
  );
  const result = optimizeMonthlyAssignments({
    ...baseInput([slot], [
      createServant("locked-monitor"),
      createServant("history-servant"),
      createServant("fresh-servant"),
    ]),
    schedules: [publishedHistory],
  });

  if (!result.ok) throw new Error("Expected generation to succeed.");
  const workload = result.workloads.find((item) => item.servant_id === "history-servant");
  assertEqual(workload?.existing_assignments, 1, "The preserved historical-month commitment remains part of total workload.");
  assertEqual(workload?.eligible_opportunities, 2, "The existing commitment and a new eligible service both count as practical opportunities.");
  assertEqual(workload?.utilization, 0.5, "One preserved assignment across two practical opportunities should produce 50% utilization.");
});

Deno.test("monthly manual preview candidate lookup excludes hard conflicts and manual-only roster members", () => {
  const slot = createSlot("2026-11-08", "Sunday Service", "09:00", "11:00", [
    { role: "Monitor", servant_id: "locked-monitor" },
  ]);
  const input = baseInput(
    [slot],
    [
      createServant("locked-monitor"),
      createServant("unavailable"),
      createServant("manual-only"),
      createServant("available"),
    ],
  );
  input.availability = [
    { servant_id: "unavailable", service_date: "2026-11-08", status: "unavailable" },
  ];
  input.autoAssignmentExcludedServantIds = ["manual-only"];

  const candidates = getMonthlyAssignmentCandidates(input, slot, "FOH");
  assertEqual(candidates.map((servant) => servant.id), ["available"], "Manual preview selection should offer only live, auto-assignable, conflict-free candidates.");
});

Deno.test("monthly manual preview candidates retain the current role selection while allowing alternatives", () => {
  const slot = createSlot("2026-11-08", "Sunday Service", "09:00", "11:00", [
    { role: "FOH", servant_id: "manual-selected" },
    { role: "Monitor", servant_id: "locked-monitor" },
  ]);
  slot.assignments[0].preview_manual = true;

  const candidates = getMonthlyAssignmentCandidates(
    baseInput([slot], [
      createServant("manual-selected"),
      createServant("locked-monitor"),
      createServant("alternative"),
    ]),
    slot,
    "FOH",
  );

  assertEqual(candidates.map((servant) => servant.id), ["alternative", "manual-selected"], "The currently selected manual servant remains selectable, but another locked role blocks that servant.");
});

Deno.test("monthly optimizer treats manual preview selections as generated, not preserved database assignments", () => {
  const slot = createSlot("2026-11-08", "Sunday Service", "09:00", "11:00", [
    { role: "FOH", servant_id: "manual-foh" },
    { role: "Monitor", servant_id: "locked-monitor" },
  ]);
  slot.assignments[0].preview_manual = true;
  const result = optimizeMonthlyAssignments(baseInput(
    [slot],
    [createServant("manual-foh"), createServant("locked-monitor")],
  ));

  if (!result.ok) throw new Error("Expected generation to succeed.");
  assertEqual(result.lockedAssignmentCount, 1, "Only the persisted Monitor assignment is locked.");
  assertEqual(result.generatedAssignmentCount, 1, "The manual preview choice is a generated plan item.");
  assertEqual(result.assignments[0].preview_manual, true, "The result keeps manual preview provenance.");
  assertEqual(result.filledRequiredPositionCount, 2, "Manual preview choices count once toward required coverage.");
  assertEqual(result.workloads.find((item) => item.servant_id === "manual-foh")?.existing_assignments, 0, "A preview-only choice is not reported as an existing persisted assignment.");
  assertEqual(result.workloads.find((item) => item.servant_id === "manual-foh")?.generated_assignments, 1, "A preview-only choice is included in proposed workload.");
});

Deno.test("monthly optimizer is deterministic and does not mutate its inputs", () => {
  const slots = [createSlot("2026-11-08", "Sunday Service", "09:00", "11:00")];
  const input = baseInput(slots, [createServant("servant-b"), createServant("servant-a")]);
  const before = JSON.stringify(input);
  const first = optimizeMonthlyAssignments(input);
  const second = optimizeMonthlyAssignments(input);

  assertEqual(JSON.stringify(input), before, "Optimizer inputs must not be mutated.");
  assertEqual(first, second, "The same inputs must produce the same plan.");
});
