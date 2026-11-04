import { describe, expect, it } from "vitest";
import {
 getJakartaDate,
 parseBusinessDateAtNoon,
} from "./jakartaDate";
describe("Jakarta business date", () => {
 it("uses Asia/Jakarta rather than UTC", () => {
   expect(
     getJakartaDate(new Date("2026-11-03T17:30:00Z"))
   ).toBe("2026-11-04");
 });
 it("parses a valid business date at Jakarta noon", () => {
   expect(
     parseBusinessDateAtNoon("2026-11-04").toISOString()
   ).toBe("2026-11-04T05:00:00.000Z");
 });
 it("rejects an invalid calendar date", () => {
   expect(() =>
     parseBusinessDateAtNoon("2026-02-30")
   ).toThrow(RangeError);
 });
 it("rejects an invalid date format", () => {
   expect(() =>
     parseBusinessDateAtNoon("04-11-2026")
   ).toThrow(RangeError);
 });
});