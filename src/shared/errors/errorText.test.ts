import { describe, expect, it } from "vitest";
import { errorText } from "./errorText";
describe("errorText", () => {
 it("formats a standard JavaScript Error", () => {
   expect(errorText(new Error("Something went wrong")))
     .toBe("Something went wrong");
 });
 it("formats a Supabase-style error", () => {
   expect(errorText({
     message: "Database error",
     code: "23505",
   })).toBe("Database error · 23505");
 });
 it("includes details and error codes", () => {
   expect(errorText({
     message: "Database error",
     details: "Duplicate entry",
     code: "23505",
   })).toBe(
     "Database error · Duplicate entry · 23505"
   );
 });
 it("handles an empty object", () => {
   expect(errorText({})).toBe("{}");
 });
 it("handles null", () => {
   expect(errorText(null)).toBe("null");
 });
});