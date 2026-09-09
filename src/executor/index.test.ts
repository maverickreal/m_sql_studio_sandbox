import { describe, it, expect, vi } from "vitest";

vi.mock("./user", () => ({
  default: vi.fn(() => ({ execute: vi.fn() })),
}));

vi.mock("./admin", () => ({
  default: vi.fn(() => ({ execute: vi.fn() })),
}));

vi.mock("./cleanup", () => ({
  default: vi.fn(() => ({ execute: vi.fn() })),
}));

import { UserSqlCodeExecutor, AdminSqlCodeExecutor, CleanupExecutor } from "./index";

describe("executor barrel", () => {
  it("exports UserSqlCodeExecutor class", () => {
    expect(UserSqlCodeExecutor).toBeDefined();
    expect(typeof UserSqlCodeExecutor).toBe("function");
  });

  it("exports AdminSqlCodeExecutor class", () => {
    expect(AdminSqlCodeExecutor).toBeDefined();
    expect(typeof AdminSqlCodeExecutor).toBe("function");
  });

  it("exports CleanupExecutor class", () => {
    expect(CleanupExecutor).toBeDefined();
    expect(typeof CleanupExecutor).toBe("function");
  });
});
