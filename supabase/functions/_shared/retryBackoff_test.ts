import { retryDelaySeconds } from "./retryBackoff.ts";

function assertEquals(actual: number, expected: number, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${actual}`);
  }
}

Deno.test("retry delay doubles and is capped at fifteen minutes", () => {
  const expected = [30, 60, 120, 240, 480, 900, 900, 900];
  expected.forEach((seconds, index) => {
    assertEquals(retryDelaySeconds(index + 1), seconds, `attempt ${index + 1}`);
  });
});

Deno.test("invalid attempt values normalize to the first retry delay", () => {
  assertEquals(retryDelaySeconds(0), 30, "zero attempts");
  assertEquals(retryDelaySeconds(-2), 30, "negative attempts");
  assertEquals(retryDelaySeconds(Number.NaN), 30, "NaN attempts");
});
