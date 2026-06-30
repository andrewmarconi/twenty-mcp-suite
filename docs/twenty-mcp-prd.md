# Product Requirements Document: Twenty Orchestrator MCP Suite

## Overview

This project will deliver a modular suite of Model Context Protocol (MCP) servers for TwentyCRM, aimed primarily at self-hosted deployments that need stronger operational control, narrower tool surfaces, and better alignment between assistant capabilities and real user roles. The suite will use a shared core codebase and expose separate MCP servers for CRM workflows, analytics, data quality, and self-hosted operations so users can install only the capability packs they need.

The product exists because current Twenty MCP options mostly center on broad CRUD access, while self-hosted users need tighter security, better tool curation, richer workflow abstractions, and explicit operational controls such as backups, migrations, and environment targeting. Guidance from MCP design sources also supports smaller, purpose-oriented tool surfaces because large tool catalogs increase model confusion, raise context costs, and expose unnecessary risk.

## Problem Statement

Self-hosted TwentyCRM users face a mismatch between what existing MCP servers expose and what production deployments actually require. Current community servers emphasize direct API access and core entity CRUD, but they generally do not address granular authorization, workflow-aware abstractions, data stewardship tasks, or self-hosted operations in a first-class way.

This creates four practical problems:

- Assistants are presented with too many low-level tools, which increases context overhead and makes tool selection less reliable.
- High-risk actions are insufficiently separated from routine CRM tasks, which weakens the principle of least privilege for AI-assisted operations.
- Self-hosted teams lack MCP-native tools for environment management, migrations, exports, health checks, and guarded bulk actions.
- Custom objects, analytics, enrichment, deduplication, and business workflows are not consistently exposed as semantic, business-level tools.

## Product Vision

The product will provide a family of narrowly scoped MCP servers for TwentyCRM that feel like role-based capability packs rather than a single monolithic connector. Each server will expose a coherent operating mode, such as everyday CRM work, analytics, data quality, or platform administration, while sharing one underlying platform for auth, schema introspection, logging, policy enforcement, and Twenty API access.

The vision is to make self-hosted TwentyCRM safer and more useful in AI-assisted workflows by giving teams a modular, production-oriented integration layer that is explicit about scope, risk, and environment. In effect, the suite should turn Twenty into an AI-operable CRM platform without forcing every user to load every tool.

## Goals

### Primary goals

- Deliver a modular MCP suite with a shared core and separately installable servers for CRM, analytics, data quality, and operations.
- Minimize context flooding by ensuring each server exposes only tools relevant to a distinct user intent or role.
- Improve security posture for self-hosted deployments through explicit capability gating, environment scoping, auditability, and least-privilege design.
- Replace raw endpoint mirroring with semantic, business-level tools where appropriate.
- Support custom objects and evolving Twenty schemas through shared metadata and schema introspection in the core platform.

### Secondary goals

- Provide a consistent naming and packaging strategy across the server family so the product is understandable in assistant clients.
- Make rollout incremental, allowing users to begin with one server and add others only when needed.
- Establish a foundation for future extensions such as workflow-specific or vertical-specific servers.

## Non-Goals

The first release will not attempt to replace TwentyCRM's native application interface, deliver a full BI platform, or provide a generic wrapper around every possible REST and GraphQL endpoint. It will also not aim to support multi-tenant hosting orchestration across many customer instances in v1, though environment targeting inside a self-hosted organization is in scope.

The product will not assume that every user wants every server installed. A core design principle is that installing one server should be a normal and complete starting state for many teams.

## Target Users

### Primary users

- Technical self-hosted TwentyCRM operators who want to connect assistants to CRM data without exposing unnecessary admin or bulk-modification tools.
- Founders, RevOps users, or technical sales teams who need AI to interact with contacts, companies, opportunities, tasks, and notes in a safe, role-bounded way.
- Platform engineers and consultants managing self-hosted Twenty environments, schema changes, and operational workflows.

### Secondary users

- Analysts who need reporting and pipeline insights through MCP rather than broad transactional access.
- Data stewards who need deduplication, normalization, import validation, and enrichment workflows.

## User Personas

### Persona 1: Self-hosted CRM operator

A technical user runs TwentyCRM in a self-hosted environment and wants an assistant to help with contact lookups, task creation, and opportunity management, but does not want that same assistant to see migration or backup tools.

### Persona 2: RevOps analyst

A business operations user needs pipeline summaries, stage aging, and activity trends, but does not need record-level write access to every CRM object. This user benefits from a dedicated analytics server with high-level read models and report tools.

### Persona 3: Platform admin

An infrastructure-oriented user needs health checks, exports, migration plans, and environment-aware admin actions, ideally with dry-run support and explicit production safeguards.

### Persona 4: Data steward

A data quality user needs tools for duplicate detection, merge planning, normalization, enrichment, and import QA, but those capabilities should remain isolated from general assistant sessions.

## Product Strategy

The suite will be packaged as multiple MCP servers backed by a shared platform core. Users will usually install one server first, typically the CRM server, and later add analytics, data, or ops servers as their workflows mature.

This modular strategy follows two principles. First, MCP tool surfaces should be scoped to the task and role they support. Second, high-risk or low-frequency tools should be opt-in rather than co-located with routine daily workflows.

## Product Scope

### Shared core

The shared core will provide:

- Twenty REST and GraphQL clients, including pagination, retries, and normalized errors.
- Auth and policy layers, including API-key and service-account support, role mapping, capability gating, and audit metadata.
- Schema introspection, field metadata, relation mapping, and custom object discovery.
- Tool framework utilities for validation, rate limiting, structured results, and dry-run support.
- Observability, including structured logs, traces, tool metrics, and execution history.

### Server 1: CRM

The CRM server will target everyday assistant use cases and expose a compact, business-oriented tool set for contacts, companies, opportunities, notes, tasks, and activity summaries. This server is the default installation target for most users.

Representative tools include:

- `find_contacts`
- `find_companies`
- `get_contact_brief`
- `get_account_snapshot`
- `list_open_opportunities`
- `create_followup_task`
- `append_contact_note`
- `update_opportunity_stage`
- `get_recent_activity_summary`

### Server 2: Analytics

The analytics server will expose higher-level reporting tools rather than raw transactional CRUD. It will support funnel analysis, pipeline summaries, stage aging, saved reports, and trend reporting where the output is an aggregate or analytical view.

Representative tools include:

- `get_pipeline_summary`
- `get_stage_aging_report`
- `get_rep_activity_trends`
- `get_forecast_inputs`
- `get_account_growth_signals`
- `run_saved_report`

### Server 3: Data

The data server will focus on data stewardship and quality workflows. It will isolate tools for duplicate detection, merge planning, normalization, import validation, and enrichment orchestration so they are not advertised to general-purpose CRM assistants.

Representative tools include:

- `find_duplicate_contacts`
- `propose_merge_plan`
- `merge_records`
- `normalize_company_names`
- `validate_import_file`
- `enrich_company_record`

### Server 4: Ops

The ops server will focus on self-hosted administration and high-risk actions. It will include health checks, workspace inspection, backups or exports, schema diffs, migration planning, and guarded repair or maintenance workflows.

Representative tools include:

- `get_instance_health`
- `list_workspaces`
- `export_workspace_snapshot`
- `run_schema_diff`
- `apply_migration_plan`
- `rotate_api_credentials`
- `run_bulk_repair_dry_run`

## Functional Requirements

### Core requirements

1. The system must provide a shared core package that can be reused by all server packages without duplicating API, auth, policy, or metadata logic.
2. The system must support separate MCP server packages with independent installation, configuration, and publication metadata.
3. The system must expose tools with human-readable names and descriptions that optimize for model comprehension rather than direct endpoint parity.
4. The system must support custom objects and field metadata so tools can adapt to workspace-specific schemas.
5. The system must support environment scoping, at minimum for development, staging, and production contexts in self-hosted deployments.

### Security and governance requirements

1. The system must support least-privilege capability gating by server and by tool.
2. The system must support read-only configurations for analytics and exploratory sessions.
3. The system must support explicit enablement for destructive or bulk actions.
4. The system must support dry-run execution for high-risk bulk tools and admin operations.
5. The system must emit audit metadata for tool invocations, including environment, principal, target workspace, and execution outcome.

### Usability requirements

1. A typical user must be able to install only the CRM server and achieve a useful baseline assistant workflow.
2. The documentation must clearly explain which server to install for each use case.
3. Tool surfaces must remain intentionally constrained so that low-frequency administrative or data-quality tools do not appear in everyday CRM sessions.

## Non-Functional Requirements

- Reliability: The suite should provide stable, predictable tool behavior under self-hosted conditions, including graceful error handling and retries for Twenty API interactions.
- Performance: Tool registration and per-session schema overhead should be minimized by keeping each server narrowly scoped.
- Maintainability: All business logic should reside in shared libraries or reusable modules rather than server-specific duplicates.
- Extensibility: New servers or capability packs should be implementable without redesigning the shared core.
- Auditability: High-risk actions must be observable and reviewable after execution.

## User Experience Principles

The product should feel modular, explicit, and role-aware. A user should understand from the package name and docs whether a server is meant for routine CRM use, analysis, data stewardship, or administration.

Tool lists should stay short enough that assistant hosts can reason about them effectively. The default experience should avoid exposing high-risk operations unless a user has intentionally installed and configured the relevant server.

## Information Architecture and Packaging

A monorepo structure is recommended for the first release because it simplifies shared types, coordinated versioning, test fixtures, and end-to-end validation across server packages.

Suggested structure:

```text
packages/
  twenty-core/
  twenty-crm-mcp/
  twenty-analytics-mcp/
  twenty-data-mcp/
  twenty-ops-mcp/
  shared-test-fixtures/
apps/
  smoke-client/
```

Each MCP server package should be a thin composition layer that registers tools, applies policy, and delegates execution into the shared core. This keeps the architecture modular without fragmenting core logic.

## Success Metrics

### Product metrics

- Percentage of users who install only one server initially, indicating that the modular packaging is intuitive rather than confusing.
- Average tool count per installed server, with the aim of keeping each server's surface compact enough for reliable model use.
- Adoption rate of non-CRM servers after initial deployment, indicating whether analytics, data, and ops capabilities are discoverable and valuable.
- Number of tool invocation failures attributable to ambiguous tool selection, which should decline relative to monolithic tool catalogs.

### Operational metrics

- Time to install and configure the first useful server in a self-hosted Twenty environment.
- Percentage of high-risk actions executed in dry-run mode before commit.
- Audit coverage for destructive or bulk tools.
- Median latency for common CRM lookup and update tools.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Package sprawl confuses users. | Users may not know which server to install. | Publish a clear install matrix and make `twenty-crm-mcp` the default recommendation. |
| Boundaries between servers become fuzzy. | Duplicate tools or inconsistent behaviors emerge. | Enforce role-based scope rules and maintain a single tool-boundary matrix in the core repo. |
| Shared core becomes a bottleneck. | Server teams cannot move independently. | Keep the core small, versioned, and focused on primitives rather than feature-specific logic. |
| High-risk tools are misused in production. | Data loss or security exposure occurs. | Use explicit enablement, environment gating, dry runs, and audit logs. |
| Analytics abstractions are too rigid for customized schemas. | Reports fail to match real deployments. | Build analytics on schema introspection and extensible read models. |

## Release Plan

### Phase 1

Ship `twenty-crm-mcp` and the shared core first. This provides the highest immediate value and validates the packaging, auth, metadata, and tool design patterns.

### Phase 2

Ship `twenty-ops-mcp` next for self-hosted administrators, with guarded tools for health, export, schema inspection, and migration planning. This phase establishes the product's operational differentiation for self-hosted teams.

### Phase 3

Ship `twenty-analytics-mcp` once stable read models and report abstractions are defined. This phase should focus on a compact set of reports that map cleanly to common RevOps questions.

### Phase 4

Ship `twenty-data-mcp` after merge and enrichment guardrails are proven. This phase should prioritize safe, explainable data repair and import QA workflows.

## Open Questions

- Should the suite expose an optional workflow-specific server later, or should workflow tools stay distributed across CRM, data, and ops servers based on intent?
- What is the right minimum schema abstraction for custom objects so analytics and CRM tools remain useful without becoming fully generic query builders?
- Which auth model best balances simplicity for self-hosted teams with support for role-aware assistant execution?
- Should some tools be generated from schema metadata while others remain hand-curated composites?

## Recommendation

Proceed with a modular MCP suite under a shared family brand, with `twenty-crm-mcp` as the default entry point and separate analytics, data, and ops servers as opt-in capability packs. This structure best addresses the gaps identified in current Twenty MCP offerings while aligning with emerging MCP best practices around scope, security, and tool usability.
