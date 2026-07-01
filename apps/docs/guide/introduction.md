# Introduction

`twenty-crm-mcp` is a schema-adaptable, metadata-driven [MCP](https://modelcontextprotocol.io) server for self-hosted [Twenty CRM](https://twenty.com). It connects an AI assistant to your CRM data through a small, curated set of tools that resolve against your **live** Twenty schema — so your custom objects and fields work out of the box, and a Twenty upgrade never requires a code release.

It is the CRM segment of the **twenty-mcp-suite** monorepo. The reusable engine (transport, schema cache, generic primitives, authentication) lives in `twenty-core`; this package composes a role-scoped CRM surface over it.

## The design in one line

Tools are the stable *mechanism*; a companion Claude Skill carries the volatile *knowledge* (filter syntax, recipes, when to describe an object before writing). Because the tools read the live schema instead of hardcoding object and field names, the breakable surface stays tiny.

## What you get

- A **curated CRM toolset** scoped to the core objects — people, companies, opportunities, tasks, notes — rather than a raw endpoint dump.
- **Two ways to authenticate**: a simple API key, or browser **OAuth sign-in** where the assistant acts as you and inherits your Twenty role. See [Authentication](/guide/authentication).
- **Composite reads** like `get_contact_brief` that return a record with its related data in a single call.
- **Structured audit logging** of every tool invocation.

## Project goals

Five commitments shape what this suite is and where it goes. They double as the criteria we hold new work against.

- **Make it safe** — proper authentication and permissions, with production-ready deployment guidance. The assistant acts as you, scoped to your Twenty role, and every tool call is audited.
- **Make it usable** — a curated toolset with clear, business-shaped names and ergonomic categories aligned with real CRM workflows, rather than a raw dump of every API endpoint.
- **Make it complete** — coverage that reflects how teams actually customize Twenty: workflows, custom objects, and direct GraphQL access when the generic tools aren't enough.
- **Make it documented** — clear examples for Claude and other MCP clients, with suggested patterns and prompts you can adapt.
- **Make it robust** — performance-aware, environment-aware behavior that respects the constraints of a self-hosted instance instead of hammering it.

## Next

- [Installation & Quickstart](/guide/installation)
- [Authentication](/guide/authentication)
