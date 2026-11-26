# @dltech/atlas-wire

The contract that crosses a seam. It holds the websocket channel frames, the HTTP request and
response payloads, the constants that both sides must agree on, and the sandbox SDK wrapper.
`apps/api` and every client read it.

## Owns

- The channel frames: `serveFrameSchema`, `clientFrameSchema`, `encodeFrame`, `decodeServeFrame` and
  `decodeClientFrame`.
- The protocol handshake: `CHANNEL_SUBPROTOCOL`, `CHANNEL_PROTOCOL_VERSION`,
  `CHANNEL_PROTOCOL_MIN_VERSION`, `protocolSkewOf` and `negotiatedProtocolOf`.
- Capability negotiation: `ECapability`, `capabilitySetOf`, `supports` and the downgrade helpers in
  `agent-compat`.
- The HTTP request and response schemas that the API and its clients share.
- The sandbox SDK wrapper and its retry policies.
- The workspace path and the pod environment names that the sandbox helpers read.

## Does not own

- Event ids and event body shapes. `@dltech/atlas-core` owns them, and its branders make the ids.
- The thread record and its writes. `@dltech/atlas-control` owns them.
- Client state and the transcript. `@dltech/atlas-client` owns them.

## Entry points

| Import                   | Use it for                                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `@dltech/atlas-wire`     | The full contract: frames, payload schemas, capabilities, pod paths, sandbox helpers.                                                         |
| `@dltech/atlas-wire/web` | The browser-safe subset: thread, session, project, settings, model, memory, MCP, secret, file, access grant, GitHub and notification schemas. |

## Capabilities

### Speak the channel

- `serveFrameSchema`, `clientFrameSchema`, `ServeFrame`, `ClientFrame`: the frame unions.
- `EServeFrame`, `EClientFrame`, `EClientRequest`: the frame and request kinds.
- `encodeFrame(frame)`, `decodeServeFrame(raw)`, `decodeClientFrame(raw)`: the JSON helpers. A
  decode returns `null` for an unknown frame.
- `CHANNEL_PROTOCOL_VERSION` (33), `CHANNEL_PROTOCOL_MIN_VERSION` (29): the newest and oldest
  protocol this build speaks.
- `protocolSkewOf(peer)`, `negotiatedProtocolOf(peer)`: the overlap of two protocol ranges.
- `bearerSubprotocolOf(token)`, `tokenFromSubprotocols(list)`: the token in the subprotocol.

### Negotiate a capability

- `ECapability`: the named capabilities, for example `attachments` and `model-availability-controls`.
- `capabilitySetOf(advertised)`, `supports({ capabilities, capability })`, `SERVE_CAPABILITIES`.
- `downgradeServeFrame({ frame, capabilities })`, `downgradeRoster`, `downgradeAgentOutcome`,
  `downgradeTurnOutcome`: the older-peer forms of a frame.

### Share an HTTP payload

- `threadMessageRequestSchema`, `threadMessageReplySchema`: the send of a message to a thread.
- `modelsResponseSchema`: the model list of the providers, with the live error.
- `classifierTestOutputSchema`: the outcome of a classifier connection test, a pass with its model
  and duration or a fault with its detail.
- `memorySummarySchema`, `memoryEntrySchema`, `memoryListSchema`: the memory rows of a list and a
  read.
- `memoryPutSchema`, `memoryEditSchema`, `memoryKeySchema`: the memory write and edit payloads. A
  key names its `project` for a project scope or its `groupId` for a group scope, and `EMemoryScope`
  is `global`, `group` or `project`.
- `MEMORY_STALE_REVISION_CODE`, `MEMORY_EDIT_NO_MATCH_CODE`, `MEMORY_EDIT_AMBIGUOUS_CODE`: the
  memory error codes. `@dltech/atlas-core` owns these, and wire re-exports them.
- `accessScopeSchema`, `accessGrantSchema`, `accessGrantSaveSchema`, `accessGrantMoveSchema`: a
  grant at personal, group or project scope, the secrets and files it holds, and its writes.
  `EAccessScope` and `EAccessMemberKind` name the scopes and the member kinds.
- `fileMountSummarySchema`, `projectFileMountSetSchema`, `personalFileMountSetSchema`: a file mount
  a sandbox gets, with its mode. A personal mount path must start with `~/` or `@/`.
- The GitHub repo, sign-in and PR stream schemas (`githubRepoSchema`, `githubPrStreamFrameSchema`
  and kin). `@dltech/atlas-core` owns them, and wire re-exports them.

### Layer a project group

A project group sits between the personal and the project scope: a user-owned set of projects whose
settings, grants, skills and MCP servers apply to each project in it. `projectSchema` carries
`groupId`, which is null while the project belongs to no group.
- `projectGroupSchema`, `projectGroupListSchema`: a group with the ids of its projects.
- `projectGroupSaveSchema`, `projectGroupKeySchema`, `projectGroupAssignSchema`: create or rename by
  `id`, name one by `id`, and move a project into a group, or out of every group with a null
  `groupId`.
- `groupInstructionSchema`, `groupInstructionSaveSchema`: the one instruction document of a group
  and its save, at most `GROUP_INSTRUCTION_CHAR_LIMIT` characters.
- `EConfigLayer`, `configLayerSchema`: the five layers from lowest to highest, `built-in`,
  `personal`, `group`, `project` and `repo`. `@dltech/atlas-core` owns the enum, and wire re-exports
  it.
- `configLayerOwnerSchema`: the id and name of the row a layer comes from.
- `accessGrantLayeredListSchema`: a scope's grants one layer at a time, lowest to highest, each
  secret and file carrying the layer that overrides it. `layeredSettingsSchema` answers the same for
  settings, from `projectResources.layeredSettings` and `groupResources.layeredSettings`.
- `groupIdInputSchema`, `groupSecretSetSchema`, `groupFileMountSetSchema`,
  `groupSettingsPatchSchema`: the writes of a group's secrets, files and settings.

### Provision a sandbox

- `liveSdk`: the Vercel sandbox operations. `stateOf(status)`, `sandboxSessionIdOf(sandbox)`,
  `routedUrlOf(sandbox)`, `assertLiveSession`.
- `SANDBOX_REGION`, `SANDBOX_SERVE_PORT`, `WORKSPACE_PATH`, `SANDBOX_TIMEOUT_MS`.
- `settleRetry`, `imageOptimizeRetry`, `retrySleep(policy)`: the retry policies.
- `EBootStep`, `BOOT_STEP_ORDER`, `BOOT_STEP_EVENT_TYPE`: the boot progress the pod reports.

## Usage

Encoding a frame for a peer:

```ts
import {
  downgradeServeFrame,
  encodeFrame,
  type CapabilitySet,
  type ServeFrame,
} from '@dltech/atlas-wire'

export const encodeForPeer = (args: { frame: ServeFrame; capabilities: CapabilitySet }): string =>
  encodeFrame(downgradeServeFrame(args))
```

From `apps/web/src/features/shell/thread-pull-requests.ts`:

```ts
import type { PrStateWire, WireThread } from '@dltech/atlas-wire/web'

export function threadPullRequestsOf(args: {
  thread: WireThread
  teammates: readonly WireThread[]
  collapsed: boolean
  states: readonly PrStateWire[]
  family?: readonly WireThread[]
}): PullRequestEntry[]
```

## Rules

- Add a capability for an additive change. Do not bump `CHANNEL_PROTOCOL_VERSION`. Bump it only for
  a changed frame shape.
- Keep the previous protocol in `CHANNEL_PROTOCOL_MIN_VERSION` until no sandbox runs it.
  `scripts/check-wire-skew.ts` fails a change that drops the protocol the base spoke.
- Import `@dltech/atlas-wire/web` in a browser bundle. Do not import the root subpath there. It
  loads `@vercel/sandbox` and `zod` schemas for the server.
- `apps/api` sets `moduleResolution: Bundler` and reads the `types` entry, which points at `src`.
  The package also builds with its own `tsconfig.build.json` to `dist/`. Turbo builds it before the
  typecheck or test of a dependent. To build it alone, run
  `bun run build --filter @dltech/atlas-wire`.

## See also

- `docs/decisions/0017-wire-protocol-skew.md`: the capability and skew rules, with the incident that
  forced them.
- `packages/wire/src/capabilities.ts`: the capability list and its comments.
