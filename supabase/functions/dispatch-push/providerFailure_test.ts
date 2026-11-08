import { classifyPushFailure } from "./providerFailure.ts";

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

Deno.test("classifies expired and gone subscriptions as permanent", () => {
  for (const statusCode of [404, 410]) {
    const result = classifyPushFailure({ statusCode, body: "subscription expired" });
    assertEqual(result.statusCode, statusCode, `status ${statusCode}`);
    assertEqual(result.permanent, true, `permanent status ${statusCode}`);
  }
});

Deno.test("keeps rate limits and provider server errors retryable", () => {
  for (const statusCode of [429, 500, 502, 503, 504]) {
    const result = classifyPushFailure({ statusCode, body: "provider unavailable" });
    assertEqual(result.statusCode, statusCode, `status ${statusCode}`);
    assertEqual(result.permanent, false, `retryable status ${statusCode}`);
  }
});

Deno.test("keeps transport timeouts and unknown failures retryable", () => {
  const timeout = classifyPushFailure(new Error("network timeout"));
  assertEqual(timeout.statusCode, 0, "timeout status");
  assertEqual(timeout.permanent, false, "timeout retryability");
  assertEqual(timeout.message, "network timeout", "timeout message");
});

Deno.test("bounds provider error text before it reaches queue diagnostics", () => {
  const result = classifyPushFailure({ statusCode: 503, body: "x".repeat(1500) });
  assertEqual(result.message.length, 1000, "bounded error message");
});
