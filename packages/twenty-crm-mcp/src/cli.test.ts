import { describe, it, expect, vi } from "vitest";
import { runCli, realSetupDeps } from "./cli.js";
import { join } from "node:path";

function deps(over: Record<string, unknown> = {}) {
  return {
    store: {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
      labels: vi.fn().mockResolvedValue(["acme-oauth"]),
    },
    loadRegistry: vi.fn().mockReturnValue({
      defaultConnection: "acme-oauth",
      connections: { "acme-oauth": { baseUrl: "https://crm.acme.com", auth: "oauth" } },
    }),
    login: vi.fn().mockResolvedValue(undefined),
    runSetup: vi.fn().mockResolvedValue(0),
    runSetupNonInteractive: vi.fn().mockResolvedValue(0),
    out: vi.fn(),
    err: vi.fn(),
    ...over,
  };
}

describe("runCli", () => {
  it("login <label> resolves the baseUrl from the registry and runs the flow", async () => {
    const d = deps();
    const code = await runCli(["login", "acme-oauth"], d as never);
    expect(code).toBe(0);
    expect(d.login).toHaveBeenCalledWith(
      expect.objectContaining({ label: "acme-oauth", baseUrl: "https://crm.acme.com" }),
    );
  });

  it("login errors when the label is unknown in the registry", async () => {
    const d = deps();
    const code = await runCli(["login", "nope"], d as never);
    expect(code).toBe(1);
    expect(d.err).toHaveBeenCalledWith(expect.stringMatching(/nope/));
    expect(d.login).not.toHaveBeenCalled();
  });

  it("connections lists registry labels and their signed-in state", async () => {
    const d = deps();
    const code = await runCli(["connections"], d as never);
    expect(code).toBe(0);
    expect(d.out).toHaveBeenCalledWith(expect.stringMatching(/acme-oauth/));
  });

  it("logout <label> deletes the stored record", async () => {
    const d = deps();
    const code = await runCli(["logout", "acme-oauth"], d as never);
    expect(code).toBe(0);
    expect(d.store.delete).toHaveBeenCalledWith("acme-oauth");
  });

  it("returns a usage error for an unknown command", async () => {
    const d = deps();
    const code = await runCli(["frobnicate"], d as never);
    expect(code).toBe(1);
    expect(d.err).toHaveBeenCalledWith(expect.stringMatching(/usage/i));
  });

  it("setup delegates to runSetup and returns its code", async () => {
    const d = deps();
    const code = await runCli(["setup"], d as never);
    expect(code).toBe(0);
    expect(d.runSetup).toHaveBeenCalled();
  });

  it("usage error mentions setup", async () => {
    const d = deps();
    await runCli(["frobnicate"], d as never);
    expect(d.err).toHaveBeenCalledWith(expect.stringMatching(/setup/));
  });

  it("bare setup delegates to the interactive runSetup", async () => {
    const d = deps();
    const code = await runCli(["setup"], d as never);
    expect(code).toBe(0);
    expect(d.runSetup).toHaveBeenCalled();
    expect(d.runSetupNonInteractive).not.toHaveBeenCalled();
  });

  it("setup with an action flag delegates to runSetupNonInteractive with the parsed command", async () => {
    const d = deps();
    const code = await runCli(
      ["setup", "--add", "acme", "--url", "https://crm.acme.com", "--auth", "apikey"],
      d as never,
    );
    expect(code).toBe(0);
    expect(d.runSetupNonInteractive).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "add",
        label: "acme",
        url: "https://crm.acme.com",
        auth: "apikey",
      }),
    );
    expect(d.runSetup).not.toHaveBeenCalled();
  });

  it("setup with a bad flag returns 1 and reports the error", async () => {
    const d = deps();
    const code = await runCli(
      ["setup", "--add", "acme", "--url", "not-a-url", "--auth", "apikey"],
      d as never,
    );
    expect(code).toBe(1);
    expect(d.err).toHaveBeenCalledWith(expect.stringMatching(/url/i));
    expect(d.runSetup).not.toHaveBeenCalled();
    expect(d.runSetupNonInteractive).not.toHaveBeenCalled();
  });
});

describe("realSetupDeps — skill seam", () => {
  it("resolves project/user destinations and the bundled source dir", () => {
    const d = realSetupDeps({} as NodeJS.ProcessEnv);
    expect(d.skill.projectDest).toBe(join(process.cwd(), ".claude", "skills", "twenty-crm"));
    expect(d.skill.userDest.endsWith(join(".claude", "skills", "twenty-crm"))).toBe(true);
    expect(d.skill.sourceDir.endsWith(join("skill", "twenty-crm"))).toBe(true);
  });
});
