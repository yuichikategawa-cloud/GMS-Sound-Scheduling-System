import { describe, expect, it } from "vitest";
import { displayList } from "./displayList";
describe("displayList", () => {
 it("formats an array", () => {
   expect(displayList(["FOH", "Monitor"]))
     .toBe("FOH, Monitor");
 });
 it("removes empty values", () => {
   expect(displayList(["FOH", "", "Monitor"]))
     .toBe("FOH, Monitor");
 });
 it("formats JSON string arrays", () => {
   expect(displayList('["Saturday","Sunday"]'))
     .toBe("Saturday, Sunday");
 });
 it("preserves plain text", () => {
   expect(displayList("Saturday"))
     .toBe("Saturday");
 });
 it("handles null", () => {
   expect(displayList(null)).toBe("");
 });
});