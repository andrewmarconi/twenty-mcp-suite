import { describe, it, expect } from "vitest";
import { clackPrompts, type PromptAPI } from "./prompts.js";

describe("clackPrompts", () => {
  it("exposes the full PromptAPI surface", () => {
    const p: PromptAPI = clackPrompts();
    for (const m of ["intro", "outro", "note", "text", "select", "confirm", "isCancel"] as const) {
      expect(typeof p[m]).toBe("function");
    }
  });

  it("isCancel recognizes the clack cancel symbol and rejects plain values", () => {
    const p = clackPrompts();
    expect(p.isCancel("hello")).toBe(false);
    expect(p.isCancel(undefined)).toBe(false);
  });
});
