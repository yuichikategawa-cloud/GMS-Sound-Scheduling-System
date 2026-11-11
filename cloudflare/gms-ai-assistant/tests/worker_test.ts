import {
  DAILY_ADMIN_MODEL_CALL_LIMIT,
  DAILY_GMS_MODEL_CALL_LIMIT,
  extractModelText,
  validateSnapshot,
} from "../src/index.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const validSnapshot = {
  month: "2026-12",
  summary: {
    serviceCount: 1,
    requiredPositions: 2,
    filledRequiredPositions: 1,
    unfilledRequiredPositions: 1,
    proposedAssignments: 1,
    frozenServices: 0,
  },
  churches: [{
    label: "Church 1",
    totalServiceCount: 1,
    omittedServiceCount: 0,
    vacancySummary: [{ role: "Monitor", reason: "role_not_qualified", count: 1 }],
    services: [{
      label: "Service 1",
      date: "2026-12-25",
      startTime: "10:00",
      endTime: "12:00",
      special: true,
      frozen: false,
      assignments: [{
        servant: "Servant 1",
        role: "FOH",
        source: "proposed",
        qualifiedRoles: ["FOH", "Monitor"],
        availability: "available",
        totalAssignments: 3,
        servingDays: 3,
        eligibleOpportunities: 8,
        recent60DayAssignments: 2,
        roleHistoryCount: 3,
      }],
      vacancies: [{
        role: "Monitor",
        required: true,
        reason: "role_not_qualified",
        blockedCandidateCount: 1,
      }],
    }],
  }],
  workload: [{
    servant: "Servant 1",
    totalAssignments: 3,
    servingDays: 3,
    eligibleOpportunities: 8,
    utilizationPercent: 38,
    recent60DayAssignments: 2,
    roleCounts: { FOH: 3, Monitor: 2, Assistant: 0 },
  }],
};

Deno.test("Worker validates the allowlisted, anonymized scheduling snapshot", () => {
  const validated = validateSnapshot(validSnapshot);
  assert(validated !== null, "A valid anonymized scheduling snapshot should pass.");
  assert(validated?.churches[0].services[0].assignments[0].servant === "Servant 1", "Anonymous servant labels should be retained.");
});

Deno.test("Worker rejects direct servant names and arbitrary user-entered text", () => {
  const invalid = structuredClone(validSnapshot) as typeof validSnapshot;
  invalid.churches[0].services[0].assignments[0].servant = "Jane Doe";
  assert(validateSnapshot(invalid) === null, "A real name must not pass the worker allowlist.");
});

Deno.test("Worker rejects service samples that exceed the prompt-size policy", () => {
  const invalid = structuredClone(validSnapshot) as typeof validSnapshot;
  invalid.churches[0].services = Array.from({ length: 4 }, (_, index) => ({
    ...validSnapshot.churches[0].services[0],
    label: "Service " + (index + 1),
  }));
  assert(validateSnapshot(invalid) === null, "More than three sample services per church must be rejected.");
});

Deno.test("Worker hard-codes small daily inference budgets", () => {
  assert(DAILY_GMS_MODEL_CALL_LIMIT === 3, "GMS-wide model calls must be capped at three per UTC day.");
  assert(DAILY_ADMIN_MODEL_CALL_LIMIT === 1, "Each administrator must be capped at one model call per UTC day.");
});

Deno.test("Worker extracts supported plain-text responses only", () => {
  assert(extractModelText({ response: "Coverage is strong." }) === "Coverage is strong.", "Workers AI response objects should be supported.");
  assert(extractModelText({ choices: [{ message: { content: "Review one vacancy." } }] }) === "Review one vacancy.", "OpenAI-compatible response shapes should be supported.");
  assert(extractModelText({ response: 42 }) === "", "Unexpected response types should fail closed.");
});
