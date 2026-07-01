import type { CapabilityProfile } from "twenty-core";

/**
 * The everyday CRM surface: reachable objects are limited to the core CRM set, so the
 * assistant never sees or touches Twenty's system/plumbing objects. Business-named aliases
 * sit alongside the scoped generic tools for the common lookups.
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
