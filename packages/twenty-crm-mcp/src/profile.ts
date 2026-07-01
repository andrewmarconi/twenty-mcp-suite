import type { CapabilityProfile } from "twenty-core";

/**
 * The everyday CRM surface: reachable objects are limited to the core CRM set, so the
 * assistant never sees or touches Twenty's system/plumbing objects. Business-named aliases
 * sit alongside the scoped generic tools for the common lookups.
 *
 * Scope boundaries (this is a *curation* feature, not a security boundary):
 * - Scope applies to the object a tool *addresses*, not to related ids inside record bodies.
 *   A `create_records`/`upsert_records` on an in-scope object can still set a relation field
 *   to an out-of-scope object's id; Twenty itself enforces referential validity.
 * - `search` is intentionally unscoped — it full-text searches all searchable objects, so a
 *   hit may reference an object outside this scope. (Its wire format is also still provisional.)
 */
export const crmProfile: CapabilityProfile = {
  name: "crm",
  objectScope: ["people", "companies", "opportunities", "tasks", "notes"],
  tools: [
    { from: "list_object_types" },
    { from: "describe_object" },
    { from: "refresh_schema" },
    {
      from: "query_records",
      as: "find_contacts",
      bind: { object: "people" },
      description:
        "Find people (contacts) in the CRM. Filter syntax: field[operator]:value, e.g. name[eq]:Ada.",
    },
    {
      from: "query_records",
      as: "find_companies",
      bind: { object: "companies" },
      description: "Find companies in the CRM. Filter syntax: field[operator]:value.",
    },
    {
      from: "query_records",
      as: "find_opportunities",
      bind: { object: "opportunities" },
      description: "Find opportunities in the CRM. Filter syntax: field[operator]:value.",
    },
    { from: "query_records" },
    { from: "get_record" },
    {
      from: "get_record",
      as: "get_contact_brief",
      bind: { object: "people", depth: 1 },
      description:
        "Fetch one person (by id) together with their related company, notes, tasks, opportunities, and recent activity (one level deep).",
    },
    {
      from: "get_record",
      as: "get_account_snapshot",
      bind: { object: "companies", depth: 1 },
      description:
        "Fetch one company (by id) together with its related people, opportunities, notes, and tasks (one level deep).",
    },
    { from: "search" },
    {
      from: "create_records",
      as: "create_tasks",
      bind: { object: "tasks" },
      description: "Create 1–60 tasks in a single batch.",
    },
    { from: "create_records" },
    { from: "update_records" },
    { from: "delete_records" },
    { from: "upsert_records" },
  ],
};
