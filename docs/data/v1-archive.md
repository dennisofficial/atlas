# The v1 archive

Dennis, 2026-11-24: keep the v1 history because the numbers are still wanted, and let no client read
it. The rows are therefore frozen, not deleted, and not soft-deleted: nothing loads them, so no
`archivedAt` or `deletedAt` column was added to anything.

On 2026-11-25 the migration `20261125T0307_archive_v1_tables` moved twelve tables out of `public`
into the schema `v1_archive` with `ALTER TABLE ... SET SCHEMA`. It moved no rows and copied no data:
indexes, constraints, owned sequences and foreign keys followed their tables, so a table in
`v1_archive` still has the same primary key, the same unique indexes and the same foreign keys,
including the ones that point at `public."User"`, `public."Project"` and `public."OauthConnection"`.
The migration runs in one transaction with `lock_timeout = 5s`.

The tables were moved rather than dropped because the names were needed in `public`, and because a
separate schema tells a reader the data is frozen. `prisma db verify --strict` introspects only the
schemas the contract declares, so `v1_archive` is invisible to it and to `migration plan`. Do not
declare `v1_archive` in the Prisma contract: verify would then guard it forever.

Read the archive directly with SQL. Every name must be schema-qualified.

Row counts below are the production counts on 2026-11-24, before the move.

## Session

990 rows.

| column               | type            | meaning                                           |
| -------------------- | --------------- | ------------------------------------------------- |
| `id`                 | text, pk        | v1 session id                                     |
| `userId`             | text            | owner of the session                              |
| `projectId`          | text?           | project the session ran in                        |
| `repo`               | text?           | repository the session worked on                  |
| `workspace`          | text?           | workspace path inside the sandbox                 |
| `executionLocation`  | text?           | where the session ran, local or cloud             |
| `title`              | text?           | session title shown in the v1 clients             |
| `pinnedAt`           | timestamptz(3)? | when the operator pinned the session              |
| `archivedAt`         | timestamptz(3)? | when the session was archived                     |
| `deletedAt`          | timestamptz(3)? | when the session was deleted                      |
| `createdAt`          | timestamptz(3)  | when the session was created                      |
| `updatedAt`          | timestamptz(3)  | when the row last changed                         |
| `mainThreadId`       | text?, unique   | the main thread of the session                    |
| `managedBySessionId` | text?           | teammate parent session that manages this session |

Foreign keys: `userId` → `public."User"` (cascade), `projectId` → `public."Project"` (set null),
`mainThreadId` → `v1_archive."Thread"` (no action), `managedBySessionId` → `v1_archive."Session"`
(set null).

## Thread

3478 rows.

| column                    | type            | meaning                                       |
| ------------------------- | --------------- | --------------------------------------------- |
| `id`                      | text, pk        | v1 thread id                                  |
| `head`                    | integer         | sequence number of the newest committed event |
| `rev`                     | integer         | monotonic revision counter                    |
| `historyRev`              | integer         | revision of the context history after rewinds |
| `createdAt` / `updatedAt` | timestamptz(3)  | creation and last change                      |
| `parentThreadId`          | text?           | thread this thread was forked from            |
| `forkSeq`                 | integer?        | event sequence the fork started at            |
| `forkMode`                | text?           | how the fork inherited context                |
| `spawnerThreadId`         | text?           | thread that spawned this sub-agent            |
| `agentType`               | text?           | agent type of a sub-agent thread              |
| `modelRef`                | text?           | pinned model                                  |
| `modelEffort`             | text?           | pinned reasoning effort                       |
| `modelFast`               | boolean?        | whether the fast model variant was pinned     |
| `userId`                  | text            | owner                                         |
| `sessionId`               | text            | session the thread belongs to                 |
| `working`                 | boolean         | whether a turn was running                    |
| `awaiting`                | text?           | what the thread was waiting on                |
| `lastOutcome`             | text?           | outcome of the last turn                      |
| `activityAt`              | timestamptz(3)? | when the thread last had activity             |
| `lastAssistantSeq`        | integer         | sequence of the newest assistant message      |

Foreign keys: `sessionId` → `v1_archive."Session"`, `userId` → `public."User"`,
`parentThreadId` → `v1_archive."Thread"`, `spawnerThreadId` → `v1_archive."Thread"`.

## Event

1,086,758 rows. This is where the activity history lives.

| column          | type           | meaning                                                   |
| --------------- | -------------- | --------------------------------------------------------- |
| `id`            | text, pk       | event id                                                  |
| `threadId`      | text           | thread the event belongs to                               |
| `seq`           | integer        | position of the event in the thread, unique per thread    |
| `runId`         | text           | turn that produced the event                              |
| `parentRunId`   | text?          | turn that spawned the sub-agent run                       |
| `depth`         | integer        | sub-agent nesting depth                                   |
| `at`            | timestamptz(3) | when the event was appended                               |
| `type`          | text           | event kind, for example `tool-called` or `context-loaded` |
| `body`          | text           | JSON payload of the event                                 |
| `contextSlot`   | text?          | context slot recorded, for example `skill`                |
| `contextKey`    | text?          | name filled into the slot                                 |
| `contextDigest` | text?          | digest of the context content                             |
| `toolName`      | text?          | tool name for `tool-called` events                        |
| `userId`        | text           | owner                                                     |

Foreign keys: `threadId` → `v1_archive."Thread"` (cascade). Indexes: unique `(threadId, seq)`,
unique `(threadId, contextSlot, contextKey, contextDigest)`, `(threadId, type)`,
`(userId, type, at)`, `(userId, type, toolName, at)`, `(userId, contextSlot, at)`.

## Turn

170 rows. One row per model turn, with its token usage.

| column                                 | type           | meaning                                               |
| -------------------------------------- | -------------- | ----------------------------------------------------- |
| `runId`                                | text, pk       | turn id, shared with the run that produced the events |
| `threadId`                             | text           | thread the turn ran in                                |
| `status`                               | text           | how the turn ended                                    |
| `providerId`                           | text           | model provider                                        |
| `modelId`                              | text           | model                                                 |
| `steps`                                | integer        | model steps in the turn                               |
| `inputTokens` / `outputTokens`         | integer        | tokens billed                                         |
| `cacheReadTokens` / `cacheWriteTokens` | integer        | prompt tokens read from and written to the cache      |
| `startedAt` / `endedAt`                | timestamptz(3) | turn boundaries                                       |
| `durationMs`                           | integer        | turn duration                                         |
| `userId`                               | text           | owner                                                 |

Foreign key: `threadId` → `v1_archive."Thread"` (cascade). Index: `(threadId, startedAt)`,
`(userId)`.

## ThreadRead

610 rows. How far a user had read a thread.

| column               | type               | meaning                                |
| -------------------- | ------------------ | -------------------------------------- |
| `userId`, `threadId` | text, composite pk | who read which thread                  |
| `seq`                | integer            | event sequence the user had read up to |
| `updatedAt`          | timestamptz(3)     | when the marker last moved             |

Foreign keys: `userId` → `public."User"`, `threadId` → `v1_archive."Thread"` (cascade).

## ContextFile

1988 rows. Files the v1 agent had read into a thread's context.

| column      | type           | meaning                                 |
| ----------- | -------------- | --------------------------------------- |
| `id`        | text, pk       | context file id                         |
| `threadId`  | text           | thread it belonged to                   |
| `path`      | text           | path in the read set, unique per thread |
| `content`   | text           | content as last read                    |
| `digest`    | text           | digest of the content                   |
| `updatedAt` | timestamptz(3) | when it was refreshed                   |

Foreign key: `threadId` → `v1_archive."Thread"` (cascade).

## SandboxBootStep

17,840 rows. One row per step of a v1 sandbox boot.

| column      | type                  | meaning                           |
| ----------- | --------------------- | --------------------------------- |
| `id`        | text, pk              | boot step id                      |
| `sessionId` | text                  | session the boot belonged to      |
| `step`      | text                  | step name                         |
| `state`     | text                  | state of the step                 |
| `error`     | text?                 | error the step reported           |
| `gap`       | text?                 | missing dependency the step found |
| `outcome`   | text?                 | result the step recorded          |
| `repos`     | jsonb?                | repositories the step prepared    |
| `seq`       | bigint, autoincrement | order in the boot                 |
| `at`        | timestamptz(3)        | when the step ran                 |

Foreign key: `sessionId` → `v1_archive."Session"` (cascade). Index: `(sessionId, seq)`.

## CloudSandbox

455 rows. The Vercel sandbox a v1 session ran on.

| column                                            | type            | meaning                                         |
| ------------------------------------------------- | --------------- | ----------------------------------------------- |
| `id`                                              | text, pk        | row id                                          |
| `sessionId`                                       | text, unique    | session the sandbox served                      |
| `userId`                                          | text            | owner                                           |
| `sandboxId`                                       | text            | provider id of the sandbox                      |
| `name`, `region`                                  | text            | name and provider region                        |
| `vercelProjectId`                                 | text?           | Vercel project it belonged to                   |
| `state`                                           | text            | lifecycle state                                 |
| `lastActivityAt`                                  | timestamptz(3)  | last activity                                   |
| `tokenHash` / `sealedToken`                       | text / text?    | hash of the sandbox token, and the sealed token |
| `sealedGitToken`                                  | text?           | sealed git token handed to the sandbox          |
| `workspaceRemoteUrl`                              | text?           | git remote the workspace was pushed to          |
| `contextPending`                                  | boolean         | whether workspace context was still pending     |
| `pinnedModel`                                     | text?           | model pinned for the sandbox                    |
| `serveUrl`, `serveVersion`, `runningServeVersion` | text?           | serve endpoint and wanted and running versions  |
| `wakeFailedAt`, `retiredAt`, `wakeClaim`          | timestamptz(3)? | failed wake, retirement, wake lease             |
| `pendingSend`                                     | jsonb?          | message queued for the sandbox                  |
| `pendingVcpus`                                    | integer?        | cpu count a resize was moving to                |
| `runtimeCheckpoint`                               | jsonb?          | runtime checkpoint                              |
| `runtimeCheckpointRevision`                       | integer?        | revision of the checkpoint                      |
| `createdAt` / `updatedAt`                         | timestamptz(3)  | creation and last change                        |

Foreign keys: `sessionId` → `v1_archive."Session"`, `userId` → `public."User"` (cascade).

## LocalPodLease

42 rows. The lease a local pod held for a thread.

| column                    | type           | meaning                                   |
| ------------------------- | -------------- | ----------------------------------------- |
| `id`                      | text, pk       | lease id                                  |
| `userId`                  | text           | owner                                     |
| `threadId`                | text           | thread that held the pod, unique per user |
| `tokenHash`               | text, unique   | hash of the lease token                   |
| `createdAt` / `updatedAt` | timestamptz(3) | creation and last change                  |

Foreign key: `userId` → `public."User"` (cascade).

## PushDevice

2 rows. Expo push registration.

| column                                   | type           | meaning                            |
| ---------------------------------------- | -------------- | ---------------------------------- |
| `id`                                     | text, pk       | device id                          |
| `token`                                  | text, unique   | Expo push token                    |
| `platform`                               | text           | device platform                    |
| `createdAt` / `updatedAt` / `lastSeenAt` | timestamptz(3) | registration, change and last seen |
| `userId`                                 | text           | owner                              |
| `authSessionId`                          | text?          | auth session that registered it    |

Foreign key: `userId` → `public."User"` (cascade).

## ComposerDraft

3 rows. Unsent composer text, keyed by user and composer scope.

| column               | type               | meaning                         |
| -------------------- | ------------------ | ------------------------------- |
| `userId`, `scopeKey` | text, composite pk | owner and composer scope        |
| `threadId`           | text?              | thread the draft was written in |
| `text`               | text               | draft text                      |
| `attachments`        | text               | JSON attachments                |
| `updatedAt`          | timestamptz(3)     | when the draft last changed     |

Foreign keys: `userId` → `public."User"`, `threadId` → `v1_archive."Thread"` (cascade).

## OauthConnectionSandbox

5904 rows. Which provider OAuth connection was handed to which v1 sandbox.

| column                      | type               | meaning                          |
| --------------------------- | ------------------ | -------------------------------- |
| `connectionId`, `sandboxId` | text, composite pk | connection and cloud sandbox     |
| `createdAt`                 | timestamptz(3)     | when the connection was assigned |

Foreign keys: `connectionId` → `public."OauthConnection"`, `sandboxId` →
`v1_archive."CloudSandbox"` (cascade).

## Example queries

Threads started per day:

```sql
SELECT date_trunc('day', "createdAt")::date AS day, count(*) AS threads
  FROM v1_archive."Thread"
 GROUP BY 1
 ORDER BY 1;
```

Tool calls per tool name. A tool call is an `Event` of type `tool-called`; `toolName` is the column
the v1 writer filled from the call:

```sql
SELECT "toolName", count(*) AS calls
  FROM v1_archive."Event"
 WHERE type = 'tool-called' AND "toolName" IS NOT NULL
 GROUP BY 1
 ORDER BY calls DESC;
```

Skill loads per skill. A skill load is either a `context-loaded` event whose `contextSlot` is
`skill` and whose `contextKey` is the skill name, or a `tool-called` event for the `skill` tool
whose `body` carries `{"input": {"name": ...}}`:

```sql
SELECT key AS skill, count(*) AS loads
  FROM (
    SELECT "contextKey" AS key
      FROM v1_archive."Event"
     WHERE type = 'context-loaded' AND "contextSlot" = 'skill'
    UNION ALL
    SELECT CASE WHEN pg_input_is_valid(body, 'jsonb') THEN body::jsonb -> 'input' ->> 'name' END
      FROM v1_archive."Event"
     WHERE type = 'tool-called' AND "toolName" = 'skill'
  ) loads
 WHERE key IS NOT NULL
 GROUP BY 1
 ORDER BY loads DESC;
```
