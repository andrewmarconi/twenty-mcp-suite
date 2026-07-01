# Auditing

Every tool invocation emits one structured JSON line to **stderr** (stdout is reserved for the MCP protocol):

```json
{"audit":{"tool":"get_contact_brief","connection":"acme","env":"prod","outcome":"ok","ms":521}}
```

Each entry records metadata only:

| Field | Meaning |
| --- | --- |
| `tool` | The tool that was called |
| `connection` | The active connection label |
| `env` | The connection's environment, if set |
| `outcome` | `ok` or `error` |
| `ms` | Duration in milliseconds |
| `error` | The error message, on failure only |

It never logs arguments, results, tokens, or record contents. On error, the tool's error still reaches the client unchanged; the audit line is written alongside it.

Because audit goes to stderr, it appears in your MCP client's server logs without interfering with the protocol stream.
