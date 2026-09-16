import { describe, expect, it } from "bun:test";

import { COST_DANGER_USD, COST_WARN_USD, costTone } from "../sidebar-spend";
import { theme } from "../../ui/theme";

describe("costTone", () => {
  it("stays quiet below the warn threshold", () => {
    expect(costTone(0)).toBe(theme.hint);
    expect(costTone(COST_WARN_USD - 0.01)).toBe(theme.hint);
  });

  it("warns at the warn threshold", () => {
    expect(costTone(COST_WARN_USD)).toBe(theme.warn);
    expect(costTone(COST_DANGER_USD - 0.01)).toBe(theme.warn);
  });

  it("reads dangerous at the danger threshold", () => {
    expect(costTone(COST_DANGER_USD)).toBe(theme.error);
    expect(costTone(COST_DANGER_USD * 2)).toBe(theme.error);
  });
});
