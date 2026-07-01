# Skill Install via `twenty-mcp setup` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Install companion skill" action to `twenty-mcp setup`, plus a one-time proactive offer after the first connection is added, so users get the companion Skill without a manual `cp`.

**Architecture:** Keep `setup.ts` a pure function of its injected `SetupDeps` by adding a `skill` seam (source dir, project/user destinations, `exists`, `install`). All filesystem and path resolution lives in the `realSetupDeps` composition root in `cli.ts`. Tests inject a fake `skill` dep and never touch disk.

**Tech Stack:** TypeScript (ESM), `@clack/prompts` (via the `PromptAPI` wrapper), vitest, Node ≥ 20 (`fs.cpSync` recursive).

Spec: `docs/superpowers/specs/2026-07-01-skill-install-via-setup-design.md` · Issue [#20](https://github.com/andrewmarconi/twenty-mcp-suite/issues/20)

## Global Constraints

- **ESM with `.js` import extensions** on local imports (`from "./setup.js"`); cross-package imports use the bare name (`from "twenty-core"`).
- **Node ≥ 20** — `fs.cpSync(src, dest, { recursive: true })` is the copy primitive.
- **stdout is fine in the CLI** (it is a standalone process, not the MCP server) — use `deps.out`.
- **Tests inject fakes, never hit disk/network** — follow the existing `fakePrompts` / `deps()` harness in `src/setup.test.ts`.
- **Skill install is a curation UX, confirmed-overwrite only** — no content diffing, no backups.
- Package manager is **pnpm**. Run one package's suite with `pnpm --filter twenty-crm-mcp test`.

---

### Task 1: `skill` seam + `installSkillAction` + menu action

Adds the `SetupDeps.skill` type, the install action, and the menu entry that dispatches to it. Proactive-offer wiring is Task 2; real filesystem wiring is Task 3.

**Files:**
- Modify: `packages/twenty-crm-mcp/src/setup.ts` (add `skill` to `SetupDeps`, add `installSkillAction`, add menu option + dispatch)
- Test: `packages/twenty-crm-mcp/src/setup.test.ts` (add `skillDep` helper, add default `skill` to `deps()`, add a `describe("runSetup — install skill")` block)

**Interfaces:**
- Produces: `SetupDeps.skill: { sourceDir: string; projectDest: string; userDest: string; exists(dest: string): boolean; install(src: string, dest: string): void }`
- Produces: `installSkillAction(deps: SetupDeps): Promise<void>` (module-private; exercised through `runSetup`)
- Consumes: existing `deps.prompts` (`PromptAPI`), `deps.out`

- [ ] **Step 1: Add the `skillDep` test helper and wire a default `skill` into `deps()`**

In `src/setup.test.ts`, add this helper near the top (after the `fakePrompts` function):

```ts
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
```

Then, inside the `deps()` helper's returned `d` object, add a default `skill` (place it right after the `login:` line):

```ts
      login: vi.fn().mockResolvedValue(undefined),
      skill: skillDep(),
      out: vi.fn(), err: vi.fn(),
```

- [ ] **Step 2: Write the failing tests for the install action**

Append this block to `src/setup.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter twenty-crm-mcp test`
Expected: FAIL — the new tests error because `SetupDeps` has no `skill` field and `runSetup` has no `skill` menu action (TypeScript will also flag `d.skill`).

- [ ] **Step 4: Add the `skill` type to `SetupDeps`**

In `src/setup.ts`, extend the `SetupDeps` interface (add the `skill` member after `login`):

```ts
export interface SetupDeps {
  prompts: PromptAPI;
  loadRegistry(): RegistryFile | null;
  saveRegistry(reg: RegistryFile): void;
  store: TokenStore;
  login: typeof loginConnection;
  skill: {
    sourceDir: string;
    projectDest: string;
    userDest: string;
    exists(dest: string): boolean;
    install(src: string, dest: string): void;
  };
  out(msg: string): void;
  err(msg: string): void;
}
```

- [ ] **Step 5: Implement `installSkillAction`**

In `src/setup.ts`, add this function (place it just before `export async function runSetup`):

```ts
async function installSkillAction(deps: SetupDeps): Promise<void> {
  const p = deps.prompts;
  const scope = await p.select<"project" | "user">({
    message: "Install the companion skill where?",
    options: [
      { value: "project", label: "Project", hint: deps.skill.projectDest },
      { value: "user", label: "User", hint: deps.skill.userDest },
    ],
  });
  if (p.isCancel(scope)) return;

  const dest = scope === "project" ? deps.skill.projectDest : deps.skill.userDest;
  if (deps.skill.exists(dest)) {
    const ok = await p.confirm({
      message: `A skill already exists at ${dest}. Overwrite? This replaces any local edits.`,
    });
    if (p.isCancel(ok) || ok !== true) {
      p.note("Skipped.");
      return;
    }
  }

  deps.skill.install(deps.skill.sourceDir, dest);
  deps.out(`Installed companion skill → ${dest}`);
}
```

- [ ] **Step 6: Add the menu option and dispatch**

In `src/setup.ts` `runSetup`, update the action `select` type and options list, and add the dispatch branch. Change the select call to:

```ts
    const action = await p.select<"add" | "edit" | "remove" | "default" | "skill" | "done">({
      message: "What would you like to do?",
      options: [
        { value: "add", label: "Add a site" },
        { value: "edit", label: "Edit a site" },
        { value: "remove", label: "Remove a site" },
        { value: "default", label: "Set default connection" },
        { value: "skill", label: "Install companion skill" },
        { value: "done", label: "Done" },
      ],
    });
```

And add the dispatch branch alongside the others (after the `default` branch):

```ts
    else if (action === "default") reg = await chooseDefault(deps, reg);
    else if (action === "skill") await installSkillAction(deps);
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter twenty-crm-mcp test`
Expected: PASS — all `install skill` tests green, and the existing add/edit/remove/default tests still pass (default `skill.exists` returns `true`, so no behavior change elsewhere).

- [ ] **Step 8: Commit**

```bash
git add packages/twenty-crm-mcp/src/setup.ts packages/twenty-crm-mcp/src/setup.test.ts
git commit -m "feat(setup): add Install companion skill menu action (#20)"
```

---

### Task 2: proactive one-time offer after the first add

Offers the skill install at the end of `addSite`, but only when neither the project nor the user destination exists yet.

**Files:**
- Modify: `packages/twenty-crm-mcp/src/setup.ts` (append the offer to `addSite`)
- Test: `packages/twenty-crm-mcp/src/setup.test.ts` (add tests to the add-flow area)

**Interfaces:**
- Consumes: `installSkillAction` (Task 1), `deps.skill.exists`, `deps.skill.projectDest`, `deps.skill.userDest`, `deps.prompts`

- [ ] **Step 1: Write the failing tests for the proactive offer**

Append this block to `src/setup.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter twenty-crm-mcp test`
Expected: FAIL — the first test's `install` is never called (offer not implemented); the queued `true`/`"project"` answers get mis-consumed.

- [ ] **Step 3: Add the proactive offer to `addSite`**

In `src/setup.ts`, in `addSite`, replace the final `return next;` with the offer block:

```ts
  if (!deps.skill.exists(deps.skill.projectDest) && !deps.skill.exists(deps.skill.userDest)) {
    const want = await p.confirm({ message: "Install the companion skill now? (recommended)" });
    if (!p.isCancel(want) && want === true) {
      await installSkillAction(deps);
    }
  }
  return next;
```

(`p` is already `deps.prompts` in `addSite`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter twenty-crm-mcp test`
Expected: PASS — proactive-offer tests green; existing add-flow tests still green because the default `skill.exists` returns `true`, so the offer never fires for them.

- [ ] **Step 5: Commit**

```bash
git add packages/twenty-crm-mcp/src/setup.ts packages/twenty-crm-mcp/src/setup.test.ts
git commit -m "feat(setup): offer skill install once after the first connection (#20)"
```

---

### Task 3: wire the real `skill` seam in `realSetupDeps`

Resolves the bundled skill source and the project/user destinations, and implements `exists`/`install` against the real filesystem.

**Files:**
- Modify: `packages/twenty-crm-mcp/src/cli.ts` (node imports + `skill` block in `realSetupDeps`)
- Test: `packages/twenty-crm-mcp/src/cli.test.ts` (path-resolution assertions)

**Interfaces:**
- Consumes: `SetupDeps.skill` shape (Task 1)
- Produces: a real `skill` seam on the object returned by `realSetupDeps(env)`

- [ ] **Step 1: Write the failing test for path resolution**

In `src/cli.test.ts`, add these imports at the top if not already present:

```ts
import { realSetupDeps } from "./cli.js";
import { join } from "node:path";
```

Then append:

```ts
describe("realSetupDeps — skill seam", () => {
  it("resolves project/user destinations and the bundled source dir", () => {
    const d = realSetupDeps({} as NodeJS.ProcessEnv);
    expect(d.skill.projectDest).toBe(join(process.cwd(), ".claude", "skills", "twenty-crm"));
    expect(d.skill.userDest.endsWith(join(".claude", "skills", "twenty-crm"))).toBe(true);
    expect(d.skill.sourceDir.endsWith(join("skill", "twenty-crm"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter twenty-crm-mcp test src/cli.test.ts`
Expected: FAIL — `d.skill` is `undefined` (`realSetupDeps` does not yet return a `skill`).

- [ ] **Step 3: Add the node imports to `cli.ts`**

At the top of `src/cli.ts`, after the existing imports, add:

```ts
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { existsSync, mkdirSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
```

- [ ] **Step 4: Add the `skill` block to `realSetupDeps`**

In `src/cli.ts`, inside `realSetupDeps`, add the `skill` member to the returned object (after `login: loginConnection,`):

```ts
    skill: {
      sourceDir: fileURLToPath(new URL("../skill/twenty-crm", import.meta.url)),
      projectDest: join(process.cwd(), ".claude", "skills", "twenty-crm"),
      userDest: join(homedir(), ".claude", "skills", "twenty-crm"),
      exists: (dest) => existsSync(dest),
      install: (src, dest) => {
        mkdirSync(dirname(dest), { recursive: true });
        cpSync(src, dest, { recursive: true });
      },
    },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter twenty-crm-mcp test src/cli.test.ts`
Expected: PASS — `sourceDir` ends with `skill/twenty-crm` (resolved from `src/cli.ts` in the test run), and the destinations match the expected joins.

- [ ] **Step 6: Build to confirm the bins compile**

Run: `pnpm --filter twenty-crm-mcp build`
Expected: `dist/index.js` and `dist/cli-bin.js` written, no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/twenty-crm-mcp/src/cli.ts packages/twenty-crm-mcp/src/cli.test.ts
git commit -m "feat(cli): wire real skill install seam into realSetupDeps (#20)"
```

---

### Task 4: documentation

Point the docs at the `setup` action as the recommended install path, keeping the manual `cp` as a fallback.

**Files:**
- Modify: `packages/twenty-crm-mcp/README.md` (the companion-Skill section, ~lines 148–156)
- Modify: `apps/docs/guide/installation.md` (add a "Companion Skill" section after the Claude Code section)

**Interfaces:** none (docs only).

- [ ] **Step 1: Update the README companion-Skill section**

In `packages/twenty-crm-mcp/README.md`, replace the install paragraph + code block (the sentence beginning "Install it by copying the skill directory…" through the `cp -r packages/twenty-crm-mcp/...` block) with:

```markdown
The recommended way to install it is the interactive setup command, which offers to install the
skill after you add your first connection (and exposes an **Install companion skill** menu action
you can run any time):

```bash
twenty-mcp setup
```

It prompts for a **project** (`./.claude/skills/twenty-crm`) or **user** (`~/.claude/skills/twenty-crm`)
install, and overwrites an existing copy only after you confirm.

Or copy it by hand:

```bash
# from an installed package
cp -r node_modules/twenty-crm-mcp/skill/twenty-crm .claude/skills/twenty-crm
# or from a source checkout
cp -r packages/twenty-crm-mcp/skill/twenty-crm .claude/skills/twenty-crm
```
```

- [ ] **Step 2: Add a Companion Skill section to the docs site**

In `apps/docs/guide/installation.md`, append this section at the end of the file:

```markdown
## Companion Skill

The server ships with a companion Skill that gives the model the operational knowledge to use it
well (filter syntax, describe-before-write discipline, batch/upsert guidance, the `refresh_schema`
recovery reflex). Install it with the interactive setup command:

```bash
twenty-mcp setup
```

`setup` offers to install the Skill right after you add your first connection, and also exposes an
**Install companion skill** action in its menu. Choose a **project** (`./.claude/skills/twenty-crm`)
or **user** (`~/.claude/skills/twenty-crm`) install; an existing copy is overwritten only after you
confirm.

Prefer to do it by hand? Copy `skill/twenty-crm` from the installed package (or a source checkout)
into your `.claude/skills/` directory.
```

- [ ] **Step 3: Verify the docs build**

Run: `pnpm docs:build`
Expected: `build complete` with no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/twenty-crm-mcp/README.md apps/docs/guide/installation.md
git commit -m "docs: recommend twenty-mcp setup for installing the companion skill (#20)"
```

---

### Final verification

- [ ] **Step 1: Full suite + build**

Run: `pnpm -r test && pnpm -r build`
Expected: all tests pass (core unchanged; twenty-crm-mcp includes the new setup/cli tests), both bins build, docs build clean.

## Self-Review notes

- **Spec coverage:** menu action (Task 1), proactive one-time offer with "neither dest exists" guard (Task 2), project/user scopes + confirmed overwrite (Task 1 `installSkillAction`), pure `setup.ts` via injected `skill` seam (Task 1) with real wiring + `import.meta.url` source resolution (Task 3), docs with manual fallback (Task 4). `files` already contains `skill` (no packaging task needed — noted in spec).
- **Type consistency:** `skill` shape is identical in the `SetupDeps` interface (Task 1), the `skillDep` fake (Task 1), and the real wiring (Task 3): `sourceDir`, `projectDest`, `userDest`, `exists(dest)`, `install(src, dest)`. `installSkillAction(deps)` is defined in Task 1 and reused in Task 2.
- **Non-goals honored:** no `--install-skill` flag (#15), no non-Claude skill packaging (#18), no diff/backup.
