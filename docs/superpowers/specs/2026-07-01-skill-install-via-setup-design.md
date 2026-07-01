# Design: install the companion Skill from `twenty-mcp setup`

Tracking issue: [#20](https://github.com/andrewmarconi/twenty-mcp-suite/issues/20)

## Problem

The companion Skill (`packages/twenty-crm-mcp/skill/twenty-crm/SKILL.md`) is the *knowledge* half
of the architecture: filter DSL, describe-before-write discipline, batch/upsert guidance, the
`refresh_schema` recovery reflex, and how the two auth modes select access. Today it is installed by
hand — the README tells users to `cp -r node_modules/twenty-crm-mcp/skill/twenty-crm .claude/skills/`.
This is easy to miss, and without the Skill the model operates without that knowledge.

Since the Skill is a first-class part of making the server usable, installing it should be a
first-class step of the interactive `twenty-mcp setup` command (`packages/twenty-crm-mcp/src/setup.ts`).

## Goals

- Add an **"Install companion skill"** action to the interactive `setup` menu.
- Offer it **once, proactively**, right after a user adds their first connection, so first-time users
  do not miss it.
- Support **project** and **user** install scopes.
- Keep `setup.ts` a pure function of its injected dependencies — tests never touch the real
  `.claude/` directories or the real filesystem.

## Non-goals

- Non-interactive install (`twenty-mcp setup --install-skill [--user|--project]`) — deferred to
  [#15](https://github.com/andrewmarconi/twenty-mcp-suite/issues/15).
- Shipping the Skill to non-Claude agents (their skill/prompt mechanisms differ) —
  [#18](https://github.com/andrewmarconi/twenty-mcp-suite/issues/18).
- Content-aware diffing, backups, or merge of local edits. Overwrite is an explicit, confirmed
  replace (YAGNI).

## Existing structure this builds on

- `skill/` is already in the package `files` allowlist, so the bundled `skill/twenty-crm` ships to
  npm. No packaging change is required.
- `runSetup(deps)` in `setup.ts` is a menu loop over injected actions (`add`/`edit`/`remove`/
  `default`/`done`). Every side effect is reached through `SetupDeps`.
- `realSetupDeps(env)` in `cli.ts` is the composition root that wires the real implementations; the
  `cli.test.ts` / `setup.test.ts` suites inject fakes (scripted `PromptAPI`, in-memory registry,
  fake token store).

## Architecture

Keep `setup.ts` pure by injecting a `skill` seam. All environment- and filesystem-touching values are
resolved in the `realSetupDeps` composition root.

### `SetupDeps` addition

```ts
skill: {
  sourceDir: string;                        // bundled skill/twenty-crm (absolute)
  projectDest: string;                      // <cwd>/.claude/skills/twenty-crm
  userDest: string;                         // ~/.claude/skills/twenty-crm
  exists(dest: string): boolean;
  install(src: string, dest: string): void; // mkdirp(dirname(dest)) + recursive copy src -> dest
};
```

### `realSetupDeps` wiring (`cli.ts`)

- `sourceDir = fileURLToPath(new URL("../skill/twenty-crm", import.meta.url))`. Because `skill/` is a
  sibling of both `dist/` and `src/`, this resolves correctly whether the CLI runs from the built
  `dist/cli-bin.js` (published, or `node dist/cli-bin.js`) or from source via `tsx src/cli-bin.ts`.
- `projectDest = join(process.cwd(), ".claude", "skills", "twenty-crm")`.
- `userDest = join(homedir(), ".claude", "skills", "twenty-crm")`.
- `exists = (dest) => existsSync(dest)`.
- `install = (src, dest) => { mkdirSync(dirname(dest), { recursive: true }); cpSync(src, dest, { recursive: true }); }`
  (`cpSync` recursive is available on Node ≥ 20, the project's minimum).

## Behavior

### `installSkillAction(deps): Promise<void>`

1. `select` scope — Project (`skill.projectDest`) or User (`skill.userDest`), each shown with its
   resolved path as the option hint. Cancel → return, no-op.
2. `dest = scope === "project" ? skill.projectDest : skill.userDest`.
3. If `skill.exists(dest)` → `confirm("A skill already exists at <dest>. Overwrite? This replaces any
   local edits.")`. No or cancel → `note("Skipped.")` and return.
4. `skill.install(skill.sourceDir, dest)` → `out("Installed companion skill → <dest>")`.

### Menu wiring

Add `{ value: "skill", label: "Install companion skill" }` immediately before `Done` in the
`runSetup` action list, dispatching to `installSkillAction(deps)`. The action does not mutate the
registry, so the loop continues with the current `reg`.

### Proactive one-time offer

At the end of `addSite`, after the connection is saved and the auth note/sign-in has run, **only if
neither `skill.projectDest` nor `skill.userDest` exists**:

- `confirm("Install the companion skill now? (recommended)")` (default yes) → run
  `installSkillAction(deps)`.

The "neither dest exists" guard makes this fire for first-time users and stay silent for anyone who
already installed it. Cancel/no simply proceeds.

## Testing (TDD)

Match the existing `setup.test.ts` style: a scripted `PromptAPI` plus a fake `skill` dep whose
`install`/`exists` calls are recorded.

- **Scope routing:** project scope installs `(sourceDir → projectDest)`; user scope installs
  `(sourceDir → userDest)`; emits the `Installed …` message.
- **Existing skill, overwrite yes:** `exists` true + confirm yes → `install` called.
- **Existing skill, overwrite no/cancel:** `install` NOT called; `note("Skipped.")`.
- **Scope cancel:** no `install`, no output.
- **Proactive offer fires:** after `addSite`, both dests absent + confirm yes → `install` called.
- **Proactive offer suppressed:** a dest already exists → no offer, no `install`.
- **Proactive offer declined:** both dests absent + confirm no → no `install`, add still succeeds.
- **`realSetupDeps`:** light assertions that `projectDest`/`userDest` equal the expected
  `join(cwd/home, ".claude/skills/twenty-crm")` and that `sourceDir` ends with `skill/twenty-crm`.

## Documentation

- `packages/twenty-crm-mcp/README.md` and `apps/docs/guide/installation.md`: lead with the `setup`
  action as the recommended install path; keep the manual `cp -r … .claude/skills/twenty-crm` as a
  documented fallback.

## Risks

- `cpSync` recursive was experimental on older Node lines but is available and stable on Node ≥ 20
  (the project minimum) and Node 24 (dev). Acceptable; noted here so a future Node-floor change
  revisits it.
- The proactive offer's "neither dest exists" guard keys off the *default* project/user paths; a user
  who installed to a custom location would still be offered on first add. Acceptable — custom paths
  are out of scope for this iteration.
