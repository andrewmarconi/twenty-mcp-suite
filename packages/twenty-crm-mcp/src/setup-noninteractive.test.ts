import { describe, it, expect, vi } from "vitest";
import { parseSetupArgs, runSetupNonInteractive } from "./setup.js";
import type { RegistryFile } from "twenty-core";

describe("parseSetupArgs", () => {
  it("no args → interactive", () => {
    expect(parseSetupArgs([])).toEqual({ kind: "interactive" });
  });

  it("parses --add with --url and --auth", () => {
    expect(
      parseSetupArgs(["--add", "acme", "--url", "https://crm.acme.com", "--auth", "apikey"]),
    ).toEqual({ kind: "add", label: "acme", url: "https://crm.acme.com", auth: "apikey" });
  });

  it("--add without --url or --auth is an error", () => {
    expect(parseSetupArgs(["--add", "acme", "--url", "https://crm.acme.com"])).toEqual({
      error: expect.stringMatching(/--auth/),
    });
  });

  it("--add with a bad url is an error", () => {
    expect(parseSetupArgs(["--add", "acme", "--url", "not-a-url", "--auth", "apikey"])).toEqual({
      error: expect.stringMatching(/url/i),
    });
  });

  it("--add with a bad auth is an error", () => {
    expect(parseSetupArgs(["--add", "acme", "--url", "https://x.io", "--auth", "basic"])).toEqual({
      error: expect.stringMatching(/auth/i),
    });
  });

  it("--add with a bad label is an error", () => {
    expect(parseSetupArgs(["--add", "Acme!", "--url", "https://x.io", "--auth", "apikey"])).toEqual(
      { error: expect.stringMatching(/label/i) },
    );
  });

  it("parses --edit with only the fields provided", () => {
    expect(parseSetupArgs(["--edit", "acme", "--url", "https://new.io"])).toEqual({
      kind: "edit",
      label: "acme",
      url: "https://new.io",
    });
  });

  it("parses --edit --label as a rename", () => {
    expect(parseSetupArgs(["--edit", "acme", "--label", "acme-prod"])).toEqual({
      kind: "edit",
      label: "acme",
      newLabel: "acme-prod",
    });
  });

  it("--edit with no modifiers is an error", () => {
    expect(parseSetupArgs(["--edit", "acme"])).toEqual({
      error: expect.stringMatching(/--url|--auth|--label/),
    });
  });

  it("parses --remove with --purge-credentials", () => {
    expect(parseSetupArgs(["--remove", "acme", "--purge-credentials"])).toEqual({
      kind: "remove",
      label: "acme",
      purgeCredentials: true,
    });
  });

  it("parses --remove without purge as purgeCredentials:false", () => {
    expect(parseSetupArgs(["--remove", "acme"])).toEqual({
      kind: "remove",
      label: "acme",
      purgeCredentials: false,
    });
  });

  it("parses --set-default", () => {
    expect(parseSetupArgs(["--set-default", "acme"])).toEqual({
      kind: "set-default",
      label: "acme",
    });
  });

  it("parses --install-skill --scope", () => {
    expect(parseSetupArgs(["--install-skill", "--scope", "user"])).toEqual({
      kind: "install-skill",
      scope: "user",
    });
  });

  it("--install-skill without --scope is an error", () => {
    expect(parseSetupArgs(["--install-skill"])).toEqual({
      error: expect.stringMatching(/--scope/),
    });
  });

  it("--install-skill with a bad scope is an error", () => {
    expect(parseSetupArgs(["--install-skill", "--scope", "global"])).toEqual({
      error: expect.stringMatching(/scope/i),
    });
  });

  it("two action flags is an error", () => {
    expect(
      parseSetupArgs([
        "--add",
        "acme",
        "--url",
        "https://x.io",
        "--auth",
        "apikey",
        "--set-default",
        "acme",
      ]),
    ).toEqual({ error: expect.stringMatching(/one action/i) });
  });

  it("an action modifier that does not belong to the action is an error", () => {
    expect(parseSetupArgs(["--set-default", "acme", "--url", "https://x.io"])).toEqual({
      error: expect.stringMatching(/--url/),
    });
  });

  it("an unknown flag is an error", () => {
    expect(parseSetupArgs(["--frob", "x"])).toEqual({ error: expect.stringMatching(/--frob/) });
  });

  it("a value flag with no value is an error", () => {
    expect(parseSetupArgs(["--add"])).toEqual({ error: expect.stringMatching(/--add/) });
  });

  it("a bare positional argument is an error", () => {
    expect(parseSetupArgs(["acme"])).toEqual({ error: expect.stringMatching(/acme/) });
  });

  it("modifiers present but no action is an error", () => {
    expect(parseSetupArgs(["--url", "https://x.io"])).toEqual({
      error: expect.stringMatching(/action/i),
    });
  });
});

function ndeps(over: Record<string, unknown> = {}) {
  const saved: RegistryFile[] = [];
  const d = {
    prompts: {} as never,
    loadRegistry: () => ({ connections: {} }) as RegistryFile,
    saveRegistry: (reg: RegistryFile) => {
      saved.push(reg);
    },
    store: {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
      labels: vi.fn().mockResolvedValue([]),
    },
    login: vi.fn().mockResolvedValue(undefined),
    skill: {
      sourceDir: "/pkg/skill/twenty-crm",
      projectDest: "/proj/.claude/skills/twenty-crm",
      userDest: "/home/.claude/skills/twenty-crm",
      exists: () => false,
      install: vi.fn(),
    },
    out: vi.fn(),
    err: vi.fn(),
    ...over,
  };
  return { saved, d };
}

const seeded = (): RegistryFile => ({
  defaultConnection: "acme",
  connections: {
    acme: { baseUrl: "https://crm.acme.com", auth: "oauth" },
    sandbox: { baseUrl: "https://dev.acme.com", auth: "apikey" },
  },
});

describe("runSetupNonInteractive — add", () => {
  it("adds an apikey site, prints the env-var hint, and does not call login", async () => {
    const { saved, d } = ndeps();
    const code = await runSetupNonInteractive(
      { kind: "add", label: "acme", url: "https://crm.acme.com", auth: "apikey" },
      d as never,
    );
    expect(code).toBe(0);
    expect(saved.at(-1)!.connections.acme).toEqual({
      baseUrl: "https://crm.acme.com",
      auth: "apikey",
    });
    expect(d.out).toHaveBeenCalledWith(expect.stringMatching(/TWENTY_API_KEY_ACME/));
    expect(d.login).not.toHaveBeenCalled();
  });

  it("adds an oauth site, prints the login hint, and does not call login", async () => {
    const { saved, d } = ndeps();
    const code = await runSetupNonInteractive(
      { kind: "add", label: "acme", url: "https://crm.acme.com", auth: "oauth" },
      d as never,
    );
    expect(code).toBe(0);
    expect(saved.at(-1)!.connections.acme.auth).toBe("oauth");
    expect(d.out).toHaveBeenCalledWith(expect.stringMatching(/twenty-mcp login acme/));
    expect(d.login).not.toHaveBeenCalled();
  });

  it("errors (exit 1) and writes nothing when the label already exists", async () => {
    const { saved, d } = ndeps({ loadRegistry: () => seeded() });
    const code = await runSetupNonInteractive(
      { kind: "add", label: "acme", url: "https://x.io", auth: "apikey" },
      d as never,
    );
    expect(code).toBe(1);
    expect(saved).toHaveLength(0);
    expect(d.err).toHaveBeenCalledWith(expect.stringMatching(/already exists/));
  });
});

describe("runSetupNonInteractive — edit", () => {
  it("changes only the provided field", async () => {
    const { saved, d } = ndeps({ loadRegistry: () => seeded() });
    const code = await runSetupNonInteractive(
      { kind: "edit", label: "acme", url: "https://new.acme.com" },
      d as never,
    );
    expect(code).toBe(0);
    expect(saved.at(-1)!.connections.acme.baseUrl).toBe("https://new.acme.com");
    expect(saved.at(-1)!.connections.acme.auth).toBe("oauth"); // unchanged
  });

  it("renames a site and moves the default with it", async () => {
    const { saved, d } = ndeps({ loadRegistry: () => seeded() });
    await runSetupNonInteractive(
      { kind: "edit", label: "acme", newLabel: "acme-prod" },
      d as never,
    );
    const last = saved.at(-1)!;
    expect(last.connections.acme).toBeUndefined();
    expect(last.connections["acme-prod"]).toBeDefined();
    expect(last.defaultConnection).toBe("acme-prod");
    expect(d.out).toHaveBeenCalledWith(expect.stringMatching(/twenty-mcp login acme-prod/));
  });

  it("errors when the label is unknown", async () => {
    const { saved, d } = ndeps({ loadRegistry: () => seeded() });
    const code = await runSetupNonInteractive(
      { kind: "edit", label: "nope", url: "https://x.io" },
      d as never,
    );
    expect(code).toBe(1);
    expect(saved).toHaveLength(0);
  });
});

describe("runSetupNonInteractive — remove", () => {
  it("removes the entry and purges credentials when asked and a token exists", async () => {
    const store = {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
      labels: vi.fn().mockResolvedValue(["acme"]),
    };
    const { saved, d } = ndeps({ loadRegistry: () => seeded(), store });
    const code = await runSetupNonInteractive(
      { kind: "remove", label: "acme", purgeCredentials: true },
      d as never,
    );
    expect(code).toBe(0);
    expect(saved.at(-1)!.connections.acme).toBeUndefined();
    expect(store.delete).toHaveBeenCalledWith("acme");
  });

  it("does not purge credentials without the flag", async () => {
    const store = {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
      labels: vi.fn().mockResolvedValue(["acme"]),
    };
    const { d } = ndeps({ loadRegistry: () => seeded(), store });
    await runSetupNonInteractive(
      { kind: "remove", label: "acme", purgeCredentials: false },
      d as never,
    );
    expect(store.delete).not.toHaveBeenCalled();
  });

  it("errors when the label is unknown", async () => {
    const { saved, d } = ndeps({ loadRegistry: () => seeded() });
    const code = await runSetupNonInteractive(
      { kind: "remove", label: "nope", purgeCredentials: false },
      d as never,
    );
    expect(code).toBe(1);
    expect(saved).toHaveLength(0);
  });
});

describe("runSetupNonInteractive — set-default & install-skill", () => {
  it("sets the default connection", async () => {
    const { saved, d } = ndeps({ loadRegistry: () => seeded() });
    const code = await runSetupNonInteractive(
      { kind: "set-default", label: "sandbox" },
      d as never,
    );
    expect(code).toBe(0);
    expect(saved.at(-1)!.defaultConnection).toBe("sandbox");
  });

  it("errors on set-default of an unknown label", async () => {
    const { saved, d } = ndeps({ loadRegistry: () => seeded() });
    const code = await runSetupNonInteractive({ kind: "set-default", label: "nope" }, d as never);
    expect(code).toBe(1);
    expect(saved).toHaveLength(0);
  });

  it("installs the skill to the chosen scope, overwriting silently", async () => {
    const { d } = ndeps();
    const code = await runSetupNonInteractive(
      { kind: "install-skill", scope: "project" },
      d as never,
    );
    expect(code).toBe(0);
    expect(d.skill.install).toHaveBeenCalledWith(
      "/pkg/skill/twenty-crm",
      "/proj/.claude/skills/twenty-crm",
    );
    expect(d.out).toHaveBeenCalledWith(expect.stringMatching(/Installed companion skill/));
  });
});
