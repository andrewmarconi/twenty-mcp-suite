import { describe, it, expect, vi } from "vitest";
import { runSetup } from "./setup.js";
import type { RegistryFile } from "twenty-core";

function fakePrompts(answers: unknown[]) {
  const q = [...answers];
  const CANCEL = Symbol.for("clack.cancel");
  const next = () => (q.length ? q.shift() : CANCEL);
  return {
    api: {
      intro: () => {}, outro: () => {}, note: () => {},
      text: async () => next(),
      select: async () => next(),
      confirm: async () => next(),
      isCancel: (v: unknown) => v === CANCEL,
    },
    CANCEL,
  };
}

function deps(answers: unknown[], over: Record<string, unknown> = {}) {
  const saved: RegistryFile[] = [];
  return {
    saved,
    d: {
      prompts: fakePrompts(answers).api,
      loadRegistry: () => ({ connections: {} }),
      saveRegistry: (reg: RegistryFile) => { saved.push(reg); },
      store: { get: vi.fn(), set: vi.fn(), delete: vi.fn().mockResolvedValue(undefined), labels: vi.fn().mockResolvedValue([]) },
      login: vi.fn().mockResolvedValue(undefined),
      out: vi.fn(), err: vi.fn(),
      ...over,
    },
  };
}

describe("runSetup — add flow", () => {
  it("adds an oauth site, persists it, and runs login when 'sign in now' is yes", async () => {
    // menu:add, label, baseUrl, auth, confirm(sign in): true, menu:done
    const { saved, d } = deps(["add", "acme", "https://crm.acme.com", "oauth", true, "done"]);
    const code = await runSetup(d as never);
    expect(code).toBe(0);
    expect(saved.at(-1)!.connections.acme).toEqual({ baseUrl: "https://crm.acme.com", auth: "oauth" });
    expect(d.login).toHaveBeenCalledWith(
      expect.objectContaining({ label: "acme", baseUrl: "https://crm.acme.com" }),
    );
  });

  it("adds an apikey site without calling login", async () => {
    const { saved, d } = deps(["add", "sandbox", "https://dev.acme.com", "apikey", "done"]);
    const code = await runSetup(d as never);
    expect(code).toBe(0);
    expect(saved.at(-1)!.connections.sandbox).toEqual({ baseUrl: "https://dev.acme.com", auth: "apikey" });
    expect(d.login).not.toHaveBeenCalled();
  });

  it("keeps the site recorded even if login throws", async () => {
    const { saved, d } = deps(["add", "acme", "https://crm.acme.com", "oauth", true, "done"], {
      login: vi.fn().mockRejectedValue(new Error("browser closed")),
    });
    const code = await runSetup(d as never);
    expect(code).toBe(0);
    expect(saved.at(-1)!.connections.acme).toBeDefined();
    expect(d.err).toHaveBeenCalledWith(expect.stringMatching(/browser closed/));
  });

  it("cancelling at the menu exits cleanly without saving", async () => {
    const { saved, d } = deps([]); // empty queue -> first select returns CANCEL
    const code = await runSetup(d as never);
    expect(code).toBe(0);
    expect(saved).toHaveLength(0);
  });
});
