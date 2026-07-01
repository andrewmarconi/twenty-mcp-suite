# Object scoping

The CRM segment is scoped to the core CRM objects:

- `people`
- `companies`
- `opportunities`
- `tasks`
- `notes`

`list_object_types` returns only these, so the assistant never sees Twenty's system and plumbing objects. Any tool call that addresses an object outside the scope is refused before it reaches Twenty:

```
Object "workflows" is not available in the "crm" profile.
```

Scoping is enforced by resolving the requested object against the live schema, so it is not a hardcoded list — it composes with custom objects you add to the scope.

## Boundaries

This is a **curation** feature, not a security boundary. Two things worth knowing:

- **Scope applies to the addressed object, not to related ids inside record bodies.** A write to an in-scope object can still set a relation field to an out-of-scope object's id; Twenty itself enforces referential validity.
- **`search` is unscoped by design.** It full-text searches all searchable objects, so a hit may reference an object outside the CRM scope.

For real access control, use an [OAuth connection](/guide/authentication): the assistant then acts as a specific user and inherits that user's Twenty role.
