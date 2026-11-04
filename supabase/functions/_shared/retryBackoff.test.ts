import { describe, expect, it } from "vitest";
import { retryDelaySeconds } from "./retryBackoff";

describe("push retry backoff", () => {
  it("starts with a 30 second delay", () => {
    expect(retryDelaySeconds(1)).toBe(30);
  });

  it("doubles the delay for each subsequent attempt", () => {
    expect([1, 2, 3, 4, 5].map(retryDelaySeconds)).toEqual([30, 60, 120, 240, 480]);
  });

  it("caps the delay at 15 minutes", () => {
    expect(retryDelaySeconds(8)).toBe(900);
    expect(retryDelaySeconds(99)).toBe(900);
  });

  it("normalizes invalid attempt values", () => {
    expect(retryDelaySeconds(0)).toBe(30);
    expect(retryDelaySeconds(-5)).toBe(30);
    expect(retryDelaySeconds(Number.NaN)).toBe(30);
  });
});
