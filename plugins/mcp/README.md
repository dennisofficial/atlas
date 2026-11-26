# @dltech/atlas-plugin-mcp

Connects a session to the MCP servers that the operator and the repository configure. The plugin reads the server definitions, connects to each server, and gives each MCP tool to the model as `mcp__<server>__<tool>`.

## Owns

- The configuration readers for the cloud rows, `.atlas/mcp.json`, `.mcp.json` and a Claude-compatible entry.
- The merge of the sources into one server list, and the rejections when an entry is bad.
- The `stdio` and `http` transports, and the connection to each server.
- The bridged tools `mcp__<server>__<tool>`.
- The `operator_mcp_sign_in` tool for an `http` server that needs a sign-in.
- The `mcp` view: one row for each server with its transport, status, tool count and layer.
- The events `mcp-server-changed`, `mcp-server-removed`, `mcp-sign-in-started` and `mcp-sign-in-resolved`.
- The MCP instructions in the context slot `McpInstructions`.
- A handoff that is invisible: a token the API could not fetch keeps the last recorded row and tools, marked `retry: true`, instead of showing `needs-auth`.
- A live `http` connection that answers 401: the client asks `PodMcpControl` for a current token once, retries the request once, and reports a sign-in only when that second attempt also fails.

## Does not own

- The OAuth grant, the token store and the callback. The `PodMcpControl` port carries them; `apps/api` serves them.
- The MCP settings screen. `apps/web` owns it, and the `mcp-edit` agent tool in `apps/api` writes the rows.
- The tool approval policy. `packages/core` owns the tool effect rules.

## Entry points

| Import                             | Use it for                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `@dltech/atlas-plugin-mcp/core`    | The entry schemas, the source merge, the row schema, the view fold and the sign-in events. |
| `@dltech/atlas-plugin-mcp/pod`     | `mcpPod(args)`, the two resources, the transports, `loadMcpConfig` and the bridge tool.    |
| `@dltech/atlas-plugin-mcp/control` | `mcpControl`: an empty control slot.                                                       |
| `@dltech/atlas-plugin-mcp/client`  | `mcpClient` and `mcpSignInEntries`: the client hook and the sign-in transcript fold.       |

## Capabilities

### Read the configuration

- `parseMcpText({ text, definedIn, origin, compat })`: reads a JSON file into entries and rejections.
- `parseMcpRows({ rows, definedIn })`: reads the cloud rows into entries and rejections.
- `mergeMcpSources({ sources })`: gives the selected server of each name, the shadowed servers and the rejections.
- `loadMcpConfig(args)`: reads the cloud rows and the two repository files, then merges them.
- `McpConfigPort`: the port that supplies the cloud rows for a session.

### Talk to a server

- `McpClients` and `serverIdOf({ sessionId, name })`: the connection pool that keeps one client for
  each server.
- `StdioClient`, `HttpClient` and `ProxyClient`: the three transports.
- `McpBridgeTool` and `MCP_NAME_PREFIX`: the model tool for one tool of one server, and the `mcp__` prefix of its name.
- `McpSignInTool`: the `operator_mcp_sign_in` tool.

### Read the roster

- `mcpRosterOfEvents(events)` and `mcpRosterRows(snapshot)`: the `mcp` rows from the events and from a tools snapshot.
- `mcpSignInEntries`: the transcript episode that pairs `mcp-sign-in-started` with `mcp-sign-in-resolved`.

## Plugin contributions

### Pod tier (`mcpPod`)

| Kind     | Name                    | What it adds                                                                 |
| -------- | ----------------------- | ---------------------------------------------------------------------------- |
| Tool     | `mcp__<server>__<tool>` | One tool for each tool of a connected server.                                |
| Tool     | `operator_mcp_sign_in`  | Starts a sign-in for an `http` server that the roster shows as `needs-auth`. |
| Resource | `mcp-config`            | The resolved server list, with the layer that supplied each server.          |
| Resource | `mcp-tools`             | The tools of each server, with its status and the reason when it failed.     |

Both resources declare the cloud setting `McpServers`. They watch `.mcp.json` and `mcp.json` in the project directory and in `.atlas`.

### Core tier (`mcpCoreSlots`)

| Kind  | Name                   | What it adds                                          |
| ----- | ---------------------- | ----------------------------------------------------- |
| Event | `mcp-server-changed`   | One server row changed.                               |
| Event | `mcp-server-removed`   | One server left the roster.                           |
| Event | `mcp-sign-in-started`  | A sign-in link exists for one server and one session. |
| Event | `mcp-sign-in-resolved` | The sign-in connected, failed or expired.             |
| View  | `mcp`                  | The server rows folded from the two roster events.    |

### Client tier (`mcpClient`)

| Kind       | Name               | What it adds                                             |
| ---------- | ------------------ | -------------------------------------------------------- |
| Hook       | `mcp-roster`       | Applies to each event whose type starts `mcp-server-`.   |
| Entry fold | `mcpSignInEntries` | Draws the sign-in card and its result in the transcript. |

### Control tier (`mcpControl`)

Empty. The plugin has no control hook and no control command.

## Usage

```ts
import { mcpClient } from '@dltech/atlas-plugin-mcp/client'
import { mcpControl } from '@dltech/atlas-plugin-mcp/control'
import { mcpCoreSlots } from '@dltech/atlas-plugin-mcp/core'
import { mcpPod } from '@dltech/atlas-plugin-mcp/pod'
import { definePlugin } from '@dltech/atlas-plugin-sdk'

definePlugin({
  name: 'mcp',
  ...mcpCoreSlots,
  pod: mcpPod({ config: mcpServerPort() }),
  control: mcpControl,
  client: mcpClient,
  transport: 'stream',
})
```

## Rules

- A server name holds only letters, digits, underscores and hyphens, because the model reads it verbatim in a tool name.
- A server that is not disabled needs a `transport`.
- The sources rank in this order, from lowest to highest: cloud user, cloud group, cloud project, `.atlas/mcp.json`, `.mcp.json`. A later source wins a name.
- A `.mcp.json` entry never beats a native definition of the same name. The merge shadows it.
- Import `@dltech/atlas-plugin-mcp/pod` in the pod only. It starts processes and opens sockets.

## See also

- [The v2 package map](../../docs/decisions/0019-v2-package-map.md)
- [`packages/plugin-sdk/src/slots.ts`](../../packages/plugin-sdk/src/slots.ts)
- [`packages/plugin-sdk/src/mcp-proxy.ts`](../../packages/plugin-sdk/src/mcp-proxy.ts)
