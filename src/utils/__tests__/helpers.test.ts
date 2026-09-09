import { describe, expect, it } from "vitest";
import {
  SQLSanitiser,
  compareQueryResults,
  getSandboxDBSchemaIdForAssignment,
  SANDBOX_DB_SCHEMA_PREFIX,
} from "../index";

describe("Utils Helpers", () => {
  describe("SQLSanitiser", () => {
    it("should return 'Time Limit Exceeded!' when message contains 'statement timeout'", () => {
      const msg = "canceling statement due to statement timeout";
      expect(SQLSanitiser(msg)).toBe("Time Limit Exceeded!");
    });

    it("should return 'Memory Limit Exceeded!' when message contains 'work_mem'", () => {
      const msg = "canceling statement due to work_mem limit in process";
      expect(SQLSanitiser(msg)).toBe("Memory Limit Exceeded!");
    });

    it("should return 'Operation not allowed!' when message contains 'permission denied'", () => {
      const msg = "permission denied for table users";
      expect(SQLSanitiser(msg)).toBe("Operation not allowed!");
    });

    it("should redact schema ids matching assignment_schema_<24hex> to assignment", () => {
      const hex24 = "507f1f77bcf86cd799439011";
      const input = `relation assignment_schema_${hex24}.users does not exist`;
      expect(SQLSanitiser(input)).toBe("relation assignment.users does not exist");
    });

    it("should return default unknown error string for empty string input", () => {
      expect(SQLSanitiser("")).toBe(
        "An unknown error occurred during SQL execution.",
      );
    });

    it("should return un-sanitised message if no rule matches but redact schema if present", () => {
      const input = "syntax error at or near 'SELECT'";
      expect(SQLSanitiser(input)).toBe("syntax error at or near 'SELECT'");
    });
  });

  describe("compareQueryResults", () => {
    it("should return true for equal ordered rows", () => {
      const user = [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ];
      const solution = [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ];
      expect(compareQueryResults(user, solution, true)).toBe(true);
    });

    it("should return true for equal unordered rows when orderMatters is false", () => {
      const user = [
        { id: 2, name: "Bob" },
        { id: 1, name: "Alice" },
      ];
      const solution = [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ];
      expect(compareQueryResults(user, solution, false)).toBe(true);
      expect(compareQueryResults(user, solution, true)).toBe(false);
    });

    it("should return false for rows with unequal lengths", () => {
      const user = [{ id: 1, name: "Alice" }];
      const solution = [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ];
      expect(compareQueryResults(user, solution, false)).toBe(false);
    });

    it("should return false for rows with unequal values", () => {
      const user = [{ id: 1, name: "Alice" }];
      const solution = [{ id: 1, name: "Charlie" }];
      expect(compareQueryResults(user, solution, false)).toBe(false);
    });
  });

  describe("getSandboxDBSchemaIdForAssignment", () => {
    it("should prefix assignment seed with SANDBOX_DB_SCHEMA_PREFIX", () => {
      const seed = "test_seed_123";
      const schemaId = getSandboxDBSchemaIdForAssignment(seed);
      expect(schemaId).toBe(`${SANDBOX_DB_SCHEMA_PREFIX}${seed}`);
      expect(schemaId.startsWith(SANDBOX_DB_SCHEMA_PREFIX)).toBe(true);
    });
  });
});