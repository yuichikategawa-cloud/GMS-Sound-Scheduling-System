import {
  MONTHLY_ADMIN_MODEL_CALL_LIMIT,
  MONTHLY_ADMIN_REQUEST_LIMIT,
  MONTHLY_GMS_MODEL_CALL_LIMIT,
  MONTHLY_GMS_REQUEST_LIMIT,
  readBoundedBody,
  resolveAllowedOrigin,
  extractModelText,
  safeGuardErrorCode,
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
    utilizationPercent: 38,
    roleCounts: { FOH: 3, Monitor: 2, Assistant: 0 },
  }],
};

Deno.test("Worker allows exact configured origins and comma-separated origin lists", () => {
  assert(
    resolveAllowedOrigin("https://gms.example.com", "https://gms.example.com") === "https://gms.example.com",
    "An explicitly configured HTTPS origin should be accepted.",
  );
  assert(
    resolveAllowedOrigin("https://preview.example.com", "https://gms.example.com, https://preview.example.com") === "https://preview.example.com",
    "A matching origin in a comma-separated allowlist should be accepted.",
  );
});

Deno.test("Worker accepts only this GMS project's HTTPS Vercel Preview hosts", () => {
  assert(
    resolveAllowedOrigin(
      "https://gms-sound-scheduling-system-8kysal6gb-mike-s6.vercel.app",
      "https://gms.example.com",
    ) === "https://gms-sound-scheduling-system-8kysal6gb-mike-s6.vercel.app",
    "A generated Preview URL for the GMS project should be accepted.",
  );
  assert(
    resolveAllowedOrigin("https://another-project-123.vercel.app", "https://gms.example.com") === null,
    "Unrelated Vercel projects must remain blocked.",
  );
  assert(
    resolveAllowedOrigin("https://gms-sound-scheduling-system-abc.vercel.app.attacker.example", "") === null,
    "Lookalike hostnames must remain blocked.",
  );
  assert(
    resolveAllowedOrigin("http://gms-sound-scheduling-system-abc.vercel.app", "") === null,
    "HTTP origins must remain blocked.",
  );
});

Deno.test("Worker rejects malformed and non-origin Origin header values", () => {
  assert(resolveAllowedOrigin("not a URL", "https://gms.example.com") === null, "Malformed origins must be rejected.");
  assert(resolveAllowedOrigin("https://gms.example.com/path", "https://gms.example.com") === null, "Origin headers must not contain paths.");
});

Deno.test("Worker validates the allowlisted, anonymized scheduling snapshot", () => {
  const validated = validateSnapshot(validSnapshot);
  assert(validated !== null, "A valid anonymized scheduling snapshot should pass.");
  assert(validated?.churches[0].services[0].assignments[0].servant === "Servant 1", "Anonymous servant labels should be retained.");
});


Deno.test("Worker accepts the latest hard-constraint vacancy reasons from the scheduler", () => {
  const reasons = [
    "consecutive_day_conflict",
    "daily_service_limit",
    "service_sequence_gap",
  ];

  for (const reason of reasons) {
    const snapshot = structuredClone(validSnapshot) as typeof validSnapshot;
    snapshot.churches[0].vacancySummary[0].reason = reason;
    snapshot.churches[0].services[0].vacancies[0].reason = reason;
    assert(
      validateSnapshot(snapshot) !== null,
      "The Worker must accept the current scheduler vacancy reason: " + reason,
    );
  }
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

Deno.test("Worker enforces the approved monthly free AI budgets", () => {
  assert(MONTHLY_GMS_MODEL_CALL_LIMIT === 60, "GMS-wide successful model calls must be capped at 60 per UTC month.");
  assert(MONTHLY_ADMIN_MODEL_CALL_LIMIT === 30, "Each administrator must be capped at 30 successful model calls per UTC month.");
  assert(MONTHLY_GMS_REQUEST_LIMIT === 300, "GMS-wide request attempts must be capped at 300 per UTC month.");
  assert(MONTHLY_ADMIN_REQUEST_LIMIT === 100, "Each administrator must be capped at 100 request attempts per UTC month.");
});

Deno.test("Worker extracts supported plain-text responses only", () => {
  assert(extractModelText({ response: "Coverage is strong." }) === "Coverage is strong.", "Workers AI response objects should be supported.");
  assert(extractModelText({ choices: [{ message: { content: "Review one vacancy." } }] }) === "Review one vacancy.", "OpenAI-compatible response shapes should be supported.");
  assert(extractModelText({ response: 42 }) === "", "Unexpected response types should fail closed.");
});


Deno.test("Worker bounds request streams before JSON parsing", async () => {
  const acceptedRequest = new Request("https://example.workers.dev/v1/explain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"ok":true}',
  });
  const accepted = await readBoundedBody(acceptedRequest, 32);
  assert(accepted === '{"ok":true}', "Bodies below the byte ceiling should be read.");

  const rejectedRequest = new Request("https://example.workers.dev/v1/explain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "x".repeat(33),
  });
  const rejected = await readBoundedBody(rejectedRequest, 32);
  assert(rejected === null, "Oversized request streams must be cancelled and rejected.");
});


Deno.test("Worker extracts only safe machine-readable budget guard error codes", () => {
  assert(safeGuardErrorCode('{"error":"storage_unavailable"}') === "storage_unavailable", "A safe internal error code should be retained.");
  assert(safeGuardErrorCode('{"error":"bad code with spaces"}') === null, "Free-form error text must not be exposed.");
  assert(safeGuardErrorCode("not-json") === null, "Malformed guard responses must be treated as unknown.");
  assert(safeGuardErrorCode('{"message":"sensitive details"}') === null, "Unrecognized response fields must not be exposed.");
});
