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

function skillDep(over: Record<string, unknown> = {}) {
  return {
    sourceDir: "/pkg/skill/twenty-crm",
    projectDest: "/proj/.claude/skills/twenty-crm",
    userDest: "/home/.claude/skills/twenty-crm",
    exists: () => true, // default: "already installed" — suppresses the proactive offer
    install: vi.fn(),
    ...over,
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
      skill: skillDep(),
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

describe("runSetup — edit/remove/default", () => {
  const seeded = (): RegistryFile => ({
    defaultConnection: "acme",
    connections: {
      acme: { baseUrl: "https://crm.acme.com", auth: "oauth" },
      sandbox: { baseUrl: "https://dev.acme.com", auth: "apikey" },
    },
  });

  it("edits a site's baseUrl (no rename)", async () => {
    // menu:edit, pick:acme, newLabel:acme, baseUrl, auth, menu:done
    const { saved, d } = deps(
      ["edit", "acme", "acme", "https://new.acme.com", "oauth", "done"],
      { loadRegistry: () => seeded() },
    );
    const code = await runSetup(d as never);
    expect(code).toBe(0);
    expect(saved.at(-1)!.connections.acme.baseUrl).toBe("https://new.acme.com");
  });

  it("renames a site and moves the default with it", async () => {
    // menu:edit, pick:acme, newLabel:acme-prod, baseUrl, auth, menu:done
    const { saved, d } = deps(
      ["edit", "acme", "acme-prod", "https://crm.acme.com", "oauth", "done"],
      { loadRegistry: () => seeded() },
    );
    await runSetup(d as never);
    const last = saved.at(-1)!;
    expect(last.connections.acme).toBeUndefined();
    expect(last.connections["acme-prod"]).toBeDefined();
    expect(last.defaultConnection).toBe("acme-prod");
  });

  it("removes a site after confirmation and offers to delete stored credentials", async () => {
    // menu:remove, pick:acme, confirm(remove):true, confirm(del creds):true, menu:done
    const store = { get: vi.fn(), set: vi.fn(), delete: vi.fn().mockResolvedValue(undefined), labels: vi.fn().mockResolvedValue(["acme"]) };
    const { saved, d } = deps(
      ["remove", "acme", true, true, "done"],
      { loadRegistry: () => seeded(), store },
    );
    await runSetup(d as never);
    expect(saved.at(-1)!.connections.acme).toBeUndefined();
    expect(store.delete).toHaveBeenCalledWith("acme");
  });

  it("does not remove when the confirmation is declined", async () => {
    const { saved, d } = deps(
      ["remove", "sandbox", false, "done"],
      { loadRegistry: () => seeded() },
    );
    await runSetup(d as never);
    // no save happened for the decline; final registry still has sandbox
    const anySavedWithoutSandbox = saved.some((r) => !r.connections.sandbox);
    expect(anySavedWithoutSandbox).toBe(false);
    expect(saved).toHaveLength(0);
    expect(d.store.delete).not.toHaveBeenCalled();
  });

  it("edit on an empty registry writes nothing", async () => {
    const { saved, d } = deps(["edit", "done"], { loadRegistry: () => ({ connections: {} }) });
    const code = await runSetup(d as never);
    expect(code).toBe(0);
    expect(saved).toHaveLength(0);
  });

  it("remove on an empty registry writes nothing", async () => {
    const { saved, d } = deps(["remove", "done"], { loadRegistry: () => ({ connections: {} }) });
    expect(await runSetup(d as never)).toBe(0);
    expect(saved).toHaveLength(0);
  });

  it("set-default on an empty registry writes nothing", async () => {
    const { saved, d } = deps(["default", "done"], { loadRegistry: () => ({ connections: {} }) });
    expect(await runSetup(d as never)).toBe(0);
    expect(saved).toHaveLength(0);
  });

  it("sets the default connection", async () => {
    // menu:default, pick:sandbox, menu:done
    const { saved, d } = deps(
      ["default", "sandbox", "done"],
      { loadRegistry: () => seeded() },
    );
    await runSetup(d as never);
    expect(saved.at(-1)!.defaultConnection).toBe("sandbox");
  });
});

describe("runSetup — install skill", () => {
  it("installs to the project scope when no skill exists yet", async () => {
    // menu:skill, scope:project, menu:done
    const { d } = deps(["skill", "project", "done"], { skill: skillDep({ exists: () => false }) });
    const code = await runSetup(d as never);
    expect(code).toBe(0);
    expect(d.skill.install).toHaveBeenCalledWith("/pkg/skill/twenty-crm", "/proj/.claude/skills/twenty-crm");
    expect(d.out).toHaveBeenCalledWith(expect.stringMatching(/Installed companion skill/));
  });

  it("installs to the user scope", async () => {
    const { d } = deps(["skill", "user", "done"], { skill: skillDep({ exists: () => false }) });
    await runSetup(d as never);
    expect(d.skill.install).toHaveBeenCalledWith("/pkg/skill/twenty-crm", "/home/.claude/skills/twenty-crm");
  });

  it("overwrites an existing skill when confirmed", async () => {
    // menu:skill, scope:project, confirm(overwrite):true, menu:done
    const { d } = deps(["skill", "project", true, "done"], { skill: skillDep({ exists: () => true }) });
    await runSetup(d as never);
    expect(d.skill.install).toHaveBeenCalledWith("/pkg/skill/twenty-crm", "/proj/.claude/skills/twenty-crm");
  });

  it("skips install when an existing skill is not overwritten", async () => {
    const { d } = deps(["skill", "project", false, "done"], { skill: skillDep({ exists: () => true }) });
    await runSetup(d as never);
    expect(d.skill.install).not.toHaveBeenCalled();
  });

  it("cancelling the scope prompt is a no-op", async () => {
    // menu:skill, then empty queue -> scope select returns CANCEL, then menu CANCEL exits
    const { d } = deps(["skill"], { skill: skillDep({ exists: () => false }) });
    await runSetup(d as never);
    expect(d.skill.install).not.toHaveBeenCalled();
  });
});

describe("runSetup — proactive skill offer after first add", () => {
  it("offers and installs the skill after adding a connection when none is installed", async () => {
    // menu:add, label, baseUrl, auth:apikey, offer-confirm:true, scope:project, menu:done
    const { d } = deps(
      ["add", "acme", "https://crm.acme.com", "apikey", true, "project", "done"],
      { skill: skillDep({ exists: () => false }) },
    );
    const code = await runSetup(d as never);
    expect(code).toBe(0);
    expect(d.skill.install).toHaveBeenCalledWith("/pkg/skill/twenty-crm", "/proj/.claude/skills/twenty-crm");
  });

  it("does not offer when a skill is already installed", async () => {
    // default skillDep().exists === true -> no offer prompt is consumed
    const { saved, d } = deps(["add", "acme", "https://crm.acme.com", "apikey", "done"]);
    await runSetup(d as never);
    expect(saved.at(-1)!.connections.acme).toBeDefined();
    expect(d.skill.install).not.toHaveBeenCalled();
  });

  it("records the connection even when the offer is declined", async () => {
    // menu:add, label, baseUrl, auth:apikey, offer-confirm:false, menu:done
    const { saved, d } = deps(
      ["add", "acme", "https://crm.acme.com", "apikey", false, "done"],
      { skill: skillDep({ exists: () => false }) },
    );
    await runSetup(d as never);
    expect(saved.at(-1)!.connections.acme).toBeDefined();
    expect(d.skill.install).not.toHaveBeenCalled();
  });
});
