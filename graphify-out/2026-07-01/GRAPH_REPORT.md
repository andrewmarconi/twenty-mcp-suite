# Graph Report - TwentyCRM-MCP  (2026-07-01)

## Corpus Check
- 162 files · ~116,020 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 659 nodes · 1033 edges · 46 communities (38 shown, 8 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 57 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `38a97cb8`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_loginFlow.ts|loginFlow.ts]]
- [[_COMMUNITY_Connection Registry & CLI|Connection Registry & CLI]]
- [[_COMMUNITY_OAuth Login Flow|OAuth Login Flow]]
- [[_COMMUNITY_Documentation Concepts|Documentation Concepts]]
- [[_COMMUNITY_Root Package Manifest|Root Package Manifest]]
- [[_COMMUNITY_Auth Architecture Concepts|Auth Architecture Concepts]]
- [[_COMMUNITY_Credential Providers & OAuth|Credential Providers & OAuth]]
- [[_COMMUNITY_Schema Cache & Tools|Schema Cache & Tools]]
- [[_COMMUNITY_Suite Architecture & Drift|Suite Architecture & Drift]]
- [[_COMMUNITY_Segment Server & Aliases|Segment Server & Aliases]]
- [[_COMMUNITY_CLI & Skill Rationale|CLI & Skill Rationale]]
- [[_COMMUNITY_twenty-core Manifest|twenty-core Manifest]]
- [[_COMMUNITY_Non-Interactive Setup|Non-Interactive Setup]]
- [[_COMMUNITY_Root Workspace Scripts|Root Workspace Scripts]]
- [[_COMMUNITY_CLI Setup Dispatch|CLI Setup Dispatch]]
- [[_COMMUNITY_Docs Package Manifest|Docs Package Manifest]]
- [[_COMMUNITY_FileTokenStore Internals|FileTokenStore Internals]]
- [[_COMMUNITY_OAuth Plan (Plan 2)|OAuth Plan (Plan 2)]]
- [[_COMMUNITY_Base TypeScript Config|Base TypeScript Config]]
- [[_COMMUNITY_v1 Design & Plan|v1 Design & Plan]]
- [[_COMMUNITY_schemaTools.ts|schemaTools.ts]]
- [[_COMMUNITY_ReadWrite Tool Design|Read/Write Tool Design]]
- [[_COMMUNITY_Setup Dependency Injection|Setup Dependency Injection]]
- [[_COMMUNITY_restClient.ts|restClient.ts]]
- [[_COMMUNITY_Capability Profile Plan|Capability Profile Plan]]
- [[_COMMUNITY_Composite Reads Design|Composite Reads Design]]
- [[_COMMUNITY_Docs Deploy & Compatibility|Docs Deploy & Compatibility]]
- [[_COMMUNITY_Package TS Config|Package TS Config]]
- [[_COMMUNITY_Docs TS Config|Docs TS Config]]
- [[_COMMUNITY_Add-Site Registry Flow|Add-Site Registry Flow]]
- [[_COMMUNITY_Docs Pages Deploy|Docs Pages Deploy]]
- [[_COMMUNITY_Setup Menu Loop|Setup Menu Loop]]
- [[_COMMUNITY_REST Client|REST Client]]
- [[_COMMUNITY_SDDTDD Workflow|SDD/TDD Workflow]]
- [[_COMMUNITY_Stdout MCP Reservation|Stdout MCP Reservation]]
- [[_COMMUNITY_Plan 3b (Composites+Audit)|Plan 3b (Composites+Audit)]]
- [[_COMMUNITY_Funding Config|Funding Config]]
- [[_COMMUNITY_SLSA Provenance Workflow|SLSA Provenance Workflow]]
- [[_COMMUNITY_twenty-crm-mcp|twenty-crm-mcp]]
- [[_COMMUNITY_readTools.test.ts|readTools.test.ts]]
- [[_COMMUNITY_restClient.ts|restClient.ts]]
- [[_COMMUNITY_writeTools.test.ts|writeTools.test.ts]]
- [[_COMMUNITY_Compatibility & caveats|Compatibility & caveats]]
- [[_COMMUNITY_aggregateTool.ts|aggregateTool.ts]]

## God Nodes (most connected - your core abstractions)
1. `TokenStore` - 18 edges
2. `SchemaCache` - 18 edges
3. `FileTokenStore` - 15 edges
4. `ObjectSchema` - 14 edges
5. `runSetupNonInteractive()` - 14 edges
6. `RestClient` - 13 edges
7. `PromptAPI` - 11 edges
8. `runSetup()` - 11 edges
9. `RegistryFile` - 9 edges
10. `Connection` - 9 edges

## Surprising Connections (you probably didn't know these)
- `Schema-adaptable (metadata-driven)` --semantically_similar_to--> `Shared-promise concurrency dedup`  [INFERRED] [semantically similar]
  apps/docs/index.md → .superpowers/sdd/task-6-report.md
- `Mechanism vs knowledge principle` --semantically_similar_to--> `Batch-native writes (1-60 records)`  [INFERRED] [semantically similar]
  apps/docs/architecture/overview.md → .superpowers/sdd/task-9-brief.md
- `User priorities (safe, usable, complete, documented, robust)` --semantically_similar_to--> `Five project goals`  [INFERRED] [semantically similar]
  docs/planning/gaps.md → apps/docs/guide/introduction.md
- `pnpm-workspace.yaml (workspace config, supply-chain age guard)` --references--> `twenty-core package (reusable transport-agnostic engine)`  [INFERRED]
  pnpm-workspace.yaml → AGENTS.md
- `twenty-mcp CLI (setup/login/connections/logout)` --calls--> `loginConnection (interactive OAuth sign-in orchestration)`  [INFERRED]
  AGENTS.md → .superpowers/sdd/p2-task-6-report.md

## Import Cycles
- 1-file cycle: `packages/twenty-crm-mcp/src/prompts.ts -> packages/twenty-crm-mcp/src/prompts.ts`

## Hyperedges (group relationships)
- **OAuth PKCE login flow (discovery, PKCE, loopback, exchange, encrypted persistence)** — auth_login_connection, auth_oauth_client_discover_oauth, auth_pkce_helpers, auth_loopback_server, auth_oauth_client, auth_file_token_store [EXTRACTED 1.00]
- **Connection resolution (registry file + credential providers + config path)** — auth_registry_load_registry_file, auth_registry_connections_path, auth_oauth_provider, agents_api_key_auth, agents_connection [INFERRED 0.85]
- **Curated CRM segment pipeline: profile → buildProfileTools → createSegmentServer** — superpowers_sdd_p3a_task_3_report_crm_profile, superpowers_sdd_p3a_task_1_report_build_profile_tools, superpowers_sdd_p3a_task_2_report_create_segment_server, superpowers_sdd_p3a_task_1_report_capability_profile [INFERRED 0.85]
- **Non-interactive setup flow: SetupCommand → parseSetupArgs → runSetupNonInteractive → registry mutators** — superpowers_sdd_task_1_brief_setup_command_union, superpowers_sdd_task_1_brief_parse_setup_args, superpowers_sdd_task_2_brief_run_setup_non_interactive, superpowers_sdd_task_2_brief_registry_mutators [INFERRED 0.85]
- **MCP server wiring: buildTools aggregates schema/read/write + upsert (GraphQLClient) over stdio** — superpowers_sdd_task_11_brief_build_tools, superpowers_sdd_task_10_brief_upsert_tool, superpowers_sdd_task_10_brief_graphql_client, superpowers_sdd_task_11_brief_stdio_transport [INFERRED 0.85]
- **OAuth login orchestration** — _superpowers_sdd_task_6_brief_login_connection, _superpowers_sdd_task_6_brief_pkce, _superpowers_sdd_task_6_brief_oauth_client, _superpowers_sdd_task_6_brief_loopback, _superpowers_sdd_task_6_brief_token_store [INFERRED]
- **Generic metadata-driven tool suite** — _superpowers_sdd_task_7_report_schema_tools, _superpowers_sdd_task_8_report_read_tools, _superpowers_sdd_task_9_brief_write_tools, _superpowers_sdd_task_6_report_schema_cache, _superpowers_sdd_task_9_brief_helpers_ts [INFERRED]
- **twenty-mcp setup CLI dispatch** — _superpowers_sdd_task_3_brief_cli_setup_dispatch, _superpowers_sdd_task_2_report_parse_setup_args, _superpowers_sdd_task_2_report_run_setup_non_interactive, _superpowers_sdd_task_3_report_run_setup, _superpowers_sdd_task_5_brief_real_setup_deps [INFERRED]
- **Schema resilience flow: metadata-driven resolution + explicit drift recovery via refresh_schema, guided by the companion Skill** — apps_docs_architecture_resilience_metadata_driven, apps_docs_architecture_resilience_drift_recovery, apps_docs_tools_reference_refresh_schema, apps_docs_reference_skill_companion_skill [INFERRED 0.85]
- **Connection + auth stack: registry, OAuth sign-in, encrypted token store, and the Connection/CredentialProvider abstraction** — apps_docs_guide_connections_connection_registry, apps_docs_guide_authentication_oauth_signin, apps_docs_guide_authentication_encrypted_token_store, docs_superpowers_plans_2026_06_30_twenty_suite_plan_1_monorepo_connections_connection_abstraction [INFERRED 0.85]
- **Design thesis: user-gap priorities (safe/usable/complete/documented/robust) drive the modular, curated, role-scoped suite design** — docs_planning_gaps_user_priorities, apps_docs_guide_introduction_project_goals, docs_planning_twenty_mcp_prd_modular_suite, apps_docs_tools_scoping_curation_not_security [INFERRED 0.85]
- **OAuth Login Flow (PKCE + loopback + token exchange + encrypted store)** — docs_superpowers_plans_2026_06_30_twenty_suite_plan_2_oauth_token_store_login_flow, docs_superpowers_plans_2026_06_30_twenty_suite_plan_2_oauth_token_store_pkce, docs_superpowers_plans_2026_06_30_twenty_suite_plan_2_oauth_token_store_loopback, docs_superpowers_plans_2026_06_30_twenty_suite_plan_2_oauth_token_store_oauth_client, docs_superpowers_plans_2026_06_30_twenty_suite_plan_2_oauth_token_store_file_token_store [EXTRACTED 1.00]
- **Curated CRM Segment (profile + buildProfileTools + createSegmentServer + audit)** — docs_superpowers_plans_2026_06_30_twenty_suite_plan_3a_crm_profile_crm_profile, docs_superpowers_plans_2026_06_30_twenty_suite_plan_3a_crm_profile_build_profile_tools, docs_superpowers_plans_2026_06_30_twenty_suite_plan_3a_crm_profile_create_segment_server, docs_superpowers_plans_2026_06_30_twenty_suite_plan_3b_composites_audit_with_audit [EXTRACTED 1.00]
- **Schema-Resilience Pipeline (metadata fetch → cache → drift detection → tools)** — docs_superpowers_plans_2026_06_30_twentycrm_mcp_metadata_fetch, docs_superpowers_plans_2026_06_30_twentycrm_mcp_schema_cache, docs_superpowers_plans_2026_06_30_twentycrm_mcp_drift_detection, docs_superpowers_plans_2026_06_30_twentycrm_mcp_read_tools [EXTRACTED 1.00]

## Communities (46 total, 8 thin omitted)

### Community 0 - "loginFlow.ts"
Cohesion: 0.12
Nodes (20): loginConnection(), LoginDeps, meta, LoopbackServer, openBrowser(), parseCallback(), startLoopback(), asObject() (+12 more)

### Community 1 - "Connection Registry & CLI"
Cohesion: 0.08
Nodes (42): buildConnectionFromConfig(), ConnectionConfig, connectionsPath(), envKeyForLabel(), legacyConnectionFromEnv(), loadRegistryFile(), RegistryFile, removeConnection() (+34 more)

### Community 2 - "OAuth Login Flow"
Cohesion: 0.10
Nodes (9): ApiKeyProvider, OAuthProvider, base, Blob, FileTokenStore, rec, TokenRecord, TokenStore (+1 more)

### Community 3 - "Documentation Concepts"
Cohesion: 0.05
Nodes (45): Explicit drift recovery, Metadata-driven schema resolution, Resilience (schema-adaptable design), Analytics segment (planned), Ops segment (planned), Suite Roadmap, API key authentication, Authentication (two modes) (+37 more)

### Community 4 - "Root Package Manifest"
Cohesion: 0.05
Nodes (36): author, bin, twenty-crm-mcp, twenty-mcp, bugs, url, dependencies, @clack/prompts (+28 more)

### Community 5 - "Auth Architecture Concepts"
Cohesion: 0.10
Nodes (28): API key authentication (TWENTY_BASE_URL + TWENTY_API_KEY), Connection (named Twenty endpoint + credential provider), Connection registry (connections.json, no secrets), OAuth PKCE public-client flow (dynamic registration + discovery), twenty-mcp CLI (setup/login/connections/logout), defaultConfigDir (XDG_CONFIG_HOME/.config/twenty-mcp), DEFAULT_TOKEN_TTL_SECONDS (300s default when expires_in omitted), FileTokenStore (AES-256-GCM encrypted token store) (+20 more)

### Community 6 - "Credential Providers & OAuth"
Cohesion: 0.10
Nodes (22): loginConnection (OAuth flow), LoginDeps interface, loopback (startLoopback/openBrowser), oauthClient (register/exchange/authorize), PKCE (generateCodeVerifier/codeChallengeS256), OAuth state parameter check, TokenStore / TokenRecord, ApiKeyProvider (+14 more)

### Community 7 - "Schema Cache & Tools"
Cohesion: 0.11
Nodes (22): Shared-promise concurrency dedup, driftHint, fetchAllObjects loader, SchemaCache, refresh_schema tool, schemaTools (list/describe/refresh), ToolDef interface, readTools (query_records/get_record/search) (+14 more)

### Community 8 - "Suite Architecture & Drift"
Cohesion: 0.11
Nodes (21): apps/docs VitePress documentation site, CapabilityProfile (objectScope + business-named tool aliases), crmProfile (curated CRM capability profile), GraphQLClient (minimal, upsert-only), Schema Adaptability Principle (resilience to Twenty schema/version changes), SchemaCache (lazy-loaded schema cache, resolve/refresh), Schema drift handling (refresh_schema, never auto-healed), Tools-are-mechanism, profile/Skill-is-knowledge split (+13 more)

### Community 9 - "Segment Server & Aliases"
Cohesion: 0.14
Nodes (21): Tool arg binding + aliasing (bind/omit), buildProfileTools, CapabilityProfile type, Object-scope enforcement via live cache.resolve, createSegmentServer, createServer, wireServer (tool + resource registration), Business-named tool aliases (find_contacts/find_companies/find_opportunities/create_tasks) (+13 more)

### Community 10 - "CLI & Skill Rationale"
Cohesion: 0.11
Nodes (20): Side-effect-free CLI module (cli.ts / cli-bin.ts split), twenty-mcp CLI (login/connections/logout), SDD Progress Ledger, OAuth public-client discovery rework (RFC 8414), Task 13 live integration suite (deferred), upsertMutationName (provisional mutation-name builder), twenty-crm companion Skill (SKILL.md), Describe-before-write discipline (+12 more)

### Community 11 - "twenty-core Manifest"
Cohesion: 0.11
Nodes (17): dependencies, @modelcontextprotocol/sdk, zod, devDependencies, @types/node, typescript, vitest, exports (+9 more)

### Community 12 - "Non-Interactive Setup"
Cohesion: 0.10
Nodes (26): FileTokenStore (AES-256-GCM), Login Flow Orchestration, Loopback Callback Listener, OAuth HTTP Client, OAuthProvider (auto-refreshing credential provider), PKCE Helpers, Plan 2: OAuth Sign-In + Token Store + Setup CLI, Registry-File Loader + OAuth Connection Wiring (+18 more)

### Community 13 - "Root Workspace Scripts"
Cohesion: 0.13
Nodes (14): engines, node, license, name, packageManager, private, scripts, build (+6 more)

### Community 14 - "CLI Setup Dispatch"
Cohesion: 0.18
Nodes (12): install-skill command, parseSetupArgs, printConnections, runSetup, runSetupNonInteractive, SetupCommand type, CliDeps interface, CLI setup flag dispatch (+4 more)

### Community 15 - "Docs Package Manifest"
Cohesion: 0.18
Nodes (10): devDependencies, vitepress, name, private, scripts, build, dev, preview (+2 more)

### Community 16 - "FileTokenStore Internals"
Cohesion: 0.22
Nodes (7): SchemaCache, people, ObjectSchema, shape, people, upsertMutationName(), upsertTool()

### Community 17 - "OAuth Plan (Plan 2)"
Cohesion: 0.20
Nodes (9): buildTools(), createSegmentServer(), createServer(), ServerMeta, conn, wireServer(), main(), crmProfile (+1 more)

### Community 18 - "Base TypeScript Config"
Cohesion: 0.20
Nodes (9): compilerOptions, esModuleInterop, module, moduleResolution, resolveJsonModule, skipLibCheck, strict, target (+1 more)

### Community 19 - "v1 Design & Plan"
Cohesion: 0.09
Nodes (27): buildProfileTools, CapabilityProfile, createSegmentServer, crmProfile, Plan 3a: Capability Profiles + Curated CRM Segment, Composite Reads (get_contact_brief, get_account_snapshot), get_record depth parameter, withAudit / stderr Audit Logging (+19 more)

### Community 20 - "schemaTools.ts"
Cohesion: 0.21
Nodes (8): AuditEntry, AuditSink, auditWrap(), withAudit(), schemaTools(), people, tool(), ToolDef

### Community 21 - "Read/Write Tool Design"
Cohesion: 0.20
Nodes (8): buildProfileTools(), makeHandler(), normalizeScope(), people, profile, workflows, CapabilityProfile, ProfileToolSpec

### Community 22 - "Setup Dependency Injection"
Cohesion: 0.29
Nodes (7): SetupDeps interface, clackPrompts, Config path computed once for parity, defaultConfigDir, realSetupDeps builder, saveRegistryFile, Wire setup into CLI

### Community 23 - "restClient.ts"
Cohesion: 0.26
Nodes (3): Query, RestClient, safeJson()

### Community 24 - "Capability Profile Plan"
Cohesion: 0.27
Nodes (3): Connection, GraphQLClient, safeJson()

### Community 25 - "Composite Reads Design"
Cohesion: 0.36
Nodes (6): withDriftHandling(), recordArray, DRIFT_PATTERNS, driftHint(), isSchemaDriftError(), TwentyApiError

### Community 26 - "Docs Deploy & Compatibility"
Cohesion: 0.50
Nodes (4): GitHub Actions Pages Deploy Workflow, Docs Site (VitePress + GitHub Pages) Plan, VitePress Docs Site (apps/docs), Docs Site (VitePress on GitHub Pages) Design

### Community 27 - "Package TS Config"
Cohesion: 0.40
Nodes (4): compilerOptions, outDir, extends, include

### Community 28 - "Docs TS Config"
Cohesion: 0.40
Nodes (4): compilerOptions, outDir, extends, include

### Community 29 - "Add-Site Registry Flow"
Cohesion: 0.67
Nodes (3): addSite flow, Registry never stores secrets, upsertConnection

### Community 40 - "twenty-crm-mcp"
Cohesion: 0.18
Nodes (10): API key (simplest), Auditing, Authentication, Claude Code / Claude Desktop configuration, Companion Skill, Compatibility & caveats, OAuth sign-in (act as yourself, with your role), Quickstart (+2 more)

### Community 41 - "readTools.test.ts"
Cohesion: 0.53
Nodes (4): readTools(), cache(), people, tool()

### Community 42 - "restClient.ts"
Cohesion: 0.21
Nodes (9): fetchAllObjects(), MetadataPage, normalizeField(), normalizeObject(), RawField, RawObject, fakeRest(), RecordedCall (+1 more)

### Community 43 - "writeTools.test.ts"
Cohesion: 0.60
Nodes (4): cache(), people, tool(), writeTools()

### Community 44 - "Compatibility & caveats"
Cohesion: 0.50
Nodes (3): Compatibility & caveats, Three provisional wire formats, Validated against Twenty v2.17.2

### Community 45 - "aggregateTool.ts"
Cohesion: 0.24
Nodes (9): AGG_OPS, AggOp, aggregateShape, aggregateTool(), aggregationAlias(), AggregationSpec, aggSelector(), buildAggregateQuery() (+1 more)

## Knowledge Gaps
- **186 isolated node(s):** `Validated against Twenty v2.17.2`, `Three provisional wire formats`, `conn`, `Claude Code / Claude Desktop configuration`, `API key (simplest)` (+181 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `TokenStore` connect `OAuth Login Flow` to `loginFlow.ts`, `Connection Registry & CLI`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Why does `Connection` connect `Capability Profile Plan` to `Connection Registry & CLI`, `OAuth Login Flow`, `restClient.ts`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Why does `CapabilityProfile` connect `Read/Write Tool Design` to `OAuth Plan (Plan 2)`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **What connects `Validated against Twenty v2.17.2`, `Three provisional wire formats`, `conn` to the rest of the system?**
  _207 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `loginFlow.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12121212121212122 - nodes in this community are weakly interconnected._
- **Should `Connection Registry & CLI` be split into smaller, more focused modules?**
  _Cohesion score 0.07507914970601538 - nodes in this community are weakly interconnected._
- **Should `OAuth Login Flow` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._