import { describe, it, expect } from "vitest";
import { parseSetupArgs } from "./setup.js";

describe("parseSetupArgs", () => {
  it("no args → interactive", () => {
    expect(parseSetupArgs([])).toEqual({ kind: "interactive" });
  });

  it("parses --add with --url and --auth", () => {
    expect(parseSetupArgs(["--add", "acme", "--url", "https://crm.acme.com", "--auth", "apikey"]))
      .toEqual({ kind: "add", label: "acme", url: "https://crm.acme.com", auth: "apikey" });
  });

  it("--add without --url or --auth is an error", () => {
    expect(parseSetupArgs(["--add", "acme", "--url", "https://crm.acme.com"]))
      .toEqual({ error: expect.stringMatching(/--auth/) });
  });

  it("--add with a bad url is an error", () => {
    expect(parseSetupArgs(["--add", "acme", "--url", "not-a-url", "--auth", "apikey"]))
      .toEqual({ error: expect.stringMatching(/url/i) });
  });

  it("--add with a bad auth is an error", () => {
    expect(parseSetupArgs(["--add", "acme", "--url", "https://x.io", "--auth", "basic"]))
      .toEqual({ error: expect.stringMatching(/auth/i) });
  });

  it("--add with a bad label is an error", () => {
    expect(parseSetupArgs(["--add", "Acme!", "--url", "https://x.io", "--auth", "apikey"]))
      .toEqual({ error: expect.stringMatching(/label/i) });
  });

  it("parses --edit with only the fields provided", () => {
    expect(parseSetupArgs(["--edit", "acme", "--url", "https://new.io"]))
      .toEqual({ kind: "edit", label: "acme", url: "https://new.io" });
  });

  it("parses --edit --label as a rename", () => {
    expect(parseSetupArgs(["--edit", "acme", "--label", "acme-prod"]))
      .toEqual({ kind: "edit", label: "acme", newLabel: "acme-prod" });
  });

  it("--edit with no modifiers is an error", () => {
    expect(parseSetupArgs(["--edit", "acme"]))
      .toEqual({ error: expect.stringMatching(/--url|--auth|--label/) });
  });

  it("parses --remove with --purge-credentials", () => {
    expect(parseSetupArgs(["--remove", "acme", "--purge-credentials"]))
      .toEqual({ kind: "remove", label: "acme", purgeCredentials: true });
  });

  it("parses --remove without purge as purgeCredentials:false", () => {
    expect(parseSetupArgs(["--remove", "acme"]))
      .toEqual({ kind: "remove", label: "acme", purgeCredentials: false });
  });

  it("parses --set-default", () => {
    expect(parseSetupArgs(["--set-default", "acme"]))
      .toEqual({ kind: "set-default", label: "acme" });
  });

  it("parses --install-skill --scope", () => {
    expect(parseSetupArgs(["--install-skill", "--scope", "user"]))
      .toEqual({ kind: "install-skill", scope: "user" });
  });

  it("--install-skill without --scope is an error", () => {
    expect(parseSetupArgs(["--install-skill"]))
      .toEqual({ error: expect.stringMatching(/--scope/) });
  });

  it("--install-skill with a bad scope is an error", () => {
    expect(parseSetupArgs(["--install-skill", "--scope", "global"]))
      .toEqual({ error: expect.stringMatching(/scope/i) });
  });

  it("two action flags is an error", () => {
    expect(parseSetupArgs(["--add", "acme", "--url", "https://x.io", "--auth", "apikey", "--set-default", "acme"]))
      .toEqual({ error: expect.stringMatching(/one action/i) });
  });

  it("an action modifier that does not belong to the action is an error", () => {
    expect(parseSetupArgs(["--set-default", "acme", "--url", "https://x.io"]))
      .toEqual({ error: expect.stringMatching(/--url/) });
  });

  it("an unknown flag is an error", () => {
    expect(parseSetupArgs(["--frob", "x"]))
      .toEqual({ error: expect.stringMatching(/--frob/) });
  });

  it("a value flag with no value is an error", () => {
    expect(parseSetupArgs(["--add"]))
      .toEqual({ error: expect.stringMatching(/--add/) });
  });

  it("a bare positional argument is an error", () => {
    expect(parseSetupArgs(["acme"]))
      .toEqual({ error: expect.stringMatching(/acme/) });
  });

  it("modifiers present but no action is an error", () => {
    expect(parseSetupArgs(["--url", "https://x.io"]))
      .toEqual({ error: expect.stringMatching(/action/i) });
  });
});
