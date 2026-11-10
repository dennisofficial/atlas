# Slice 7b spec: MCP and skills

Status: **spec, 2026-11-09.** The operator's answers are in §9; PR 1, the live tool source, is built.
Anchors are `path:line` at `790898b53`; re-check before relying on one. Prior slice:
[07-plugins.md](07-plugins.md) — its §9.4 and its closing line hand these two features here.

Contract: [architecture.md](../architecture.md) §4 P8 and §7, [0019](../decisions/0019-v2-package-map.md),
[0027](../decisions/0027-both-backends-own-their-work.md) (the agent host reads Postgres itself and
calls the API for nothing).

## Goal

Two v1 capabilities no v2 session has, each as its own plugin on the slice-6 contract.
- **`plugins/mcp`.** A v2 session starts the operator's MCP servers, sees their tools under v1's
  names (`mcp__<server>__<tool>`), calls them, and is told each server's own instructions. A server
  that cannot start shows why instead of vanishing.
- **`plugins/skills`.** A v2 session sees the available skills in its prompt and loads one by name —
  from the repo clone, from the operator's cloud skills, and from the built-ins — with v1's
  precedence and v1's listing arithmetic.

**Exit criterion:**
1. One live v2 cloud session's prompt lists the operator's cloud skills and its repo's `.atlas/skills`;
   `skill` loads each kind and returns the body, and `skill_install` / `skill_edit` / `skill_delete`
   create, change and remove one in the cloud and one in the repo (recorded in §8).
2. One live v2 cloud session starts a stdio MCP server from the operator's cloud rows, its tools
   appear as `mcp__<server>__<tool>`, a call succeeds, the server's `instructions` arrive in an
   `mcp-instructions` context block, and killing the server flips the `mcp` view to failed with the
   tools gone from the next step.
3. Precedence holds for both: repo shadows cloud project shadows cloud user shadows built-in, and a
   disabled entry hides the server or skill it names.
4. With both plugins unregistered, every app behaves exactly as it does today.

## 1. What exists today

### 1.1 v1 MCP — the behaviour being reproduced

Everything is in `packages/harness/src/mcp/` (~3.9k lines with specs) plus one writer tool.
- **Config files**: `<ATLAS_HOME>/mcp.json` (user), `<cwd>/.atlas/mcp.json` (project),
  `<cwd>/.mcp.json` (Claude-Code compatibility, project root only, no parent walk)
  (`packages/harness/src/settings/paths.ts:35-49`; comment at `mcp/config/sources.ts:198`).
- **Entry shape** (`mcp/config/specs.ts:13-52`): `{name, transport?, disabled?}`, name matching
  `/^[a-zA-Z0-9_-]+$/` because the model reads it verbatim in tool names; `transport` is
  `{kind:'stdio', command, args?, env?}` or `{kind:'http', url, headers?}`; a transport is required
  unless `disabled: true`, which is what makes a bare `{disabled: true}` stub a legal way for a
  project file to switch a user server off. Both the bare object and `{"mcpServers": {...}}` parse
  (`specs.ts:54-69`); Claude's flat `{type,command,...}` is translated at `specs.ts:71-113`.
- **Reading** (`mcp/config/sources.ts:83-161`): each entry validates independently, so one bad entry
  does not kill the file; failures become `McpRejection` values; ENOENT is silent, a permission error
  is not.
- **Precedence** (`mcp/config/loaders.ts:13-38`): a native source naming a server kills the compat
  entry of the same name regardless of order, then `resolveShadowing`
  (`packages/core/src/discovery/shadowing.ts:3-44`) ranks built-in < user < project and keeps the
  earlier definition on a tie, so the fixed source order at `mcp/registry/register-mcp.ts:25-30`
  decides user-then-project.
- **Lifecycle** (`mcp/bridge/handle-store.ts`): `connectAll` is `allSettled` (`:85-87`); both connect
  and `listTools` are under a 30 s ceiling (`:23`, `:213-257`); status is
  `connected | failed | disabled | needs-auth` (`mcp/registry/handle-status.ts:4-15`); a 401 becomes
  `needs-auth`; reconnects are generation-fenced so a slow open cannot overwrite a newer one
  (`:131-143`).
- **stdio** (`mcp/transport/stdio.ts:53-59`): `Bun.spawn`, env scrubbed to `PATH` + `HOME` + the
  entry's env (`:33-37`), newline-delimited JSON-RPC led by a pinned `initialize`
  (`protocolVersion: '2025-06-18'`, empty capabilities, `:26-31`), 30 s per request, child exit
  rejects pending requests, close ends stdin, waits 2 s, then kills.
- **http** (`mcp/transport/http.ts`): POST with `accept: application/json, text/event-stream`, 30 s
  timeout, `mcp-session-id` captured and replayed, JSON and SSE both parsed, `close()` sends DELETE.
- **Tool exposure** (`mcp/bridge/bridge-tool.ts`): name `mcp__<server>__<tool>` (`:24`, `:137`),
  description falls back to the name, `inputSchema` is a permissive record while `jsonSchema` carries
  the server's raw schema (`:116`, `:145-147`), and `toToolSet` sends that raw schema to the provider
  (`packages/harness/src/model/tool-set.ts:22-27`). `readOnlyHint === true` makes the tool `Read` and
  concurrency-safe, `destructiveHint === true` makes it `Destructive`, everything else is `Write`
  (`bridge-tool.ts:44-49`). Results prefer `structuredContent`, keep text and image blocks only, cap
  text at 30 000 characters (`:26-28`).
- **Per-step freshness** (`packages/harness/src/loop/__tests__/dynamic-tools.spec.ts:105-108`): a tool
  that joins mid-turn is offered on the next step; one that leaves stops being offered and a call to
  it answers `no tool named ...` (`:164-172`).
- **Instructions** (`mcp/instructions/instructions-hook.ts:14-55`): a `beforeTurn` hook emits a
  `context-loaded` in slot `mcp-instructions` the first time a server appears, and an empty tombstone
  when it goes. The slot and its envelope text already exist in `core`
  (`packages/core/src/context/slot.ts:8`, `context/envelope.ts:53-54`).
- **Refresh** (`mcp/registry/register-mcp.ts:44`, `:97-117`): re-resolve sources, reconcile by name,
  retry `needs-auth`, all under a 5 s budget, called from `beforeTurn`
  (`apps/serve/src/serve-boot-finish.ts:135-138`) — i.e. turn boundaries only.
- **Management**: the `mcp-edit` tool (`packages/harness/src/tools/builtin/mcp-edit.ts:19-29`) writes
  `{transport}` / `{disabled:true}` into one of the three layers through
  `mcp/config/writer.ts`; `/mcp` reports status (`packages/harness/src/composition/mcp-report.ts:15-43`);
  the cloud store is `public.McpServer` + `public.McpOauthGrant`.

### 1.2 v1 skills — the behaviour being reproduced

- **Roots** (pure): `packages/core/src/skills/roots.ts:37` `skillRootPlan` — user `.atlas/skills`,
  then `.agents`, then `.claude`; project `cwd/.atlas|.agents|.claude/skills`; then the cloud root
  `~/.atlas/project-skills`, **deliberately last** (`roots.ts:50`) so cloud skills cannot shadow repo
  ones. Flavour order is Atlas > Agents > Claude (`roots.ts:21-25`).
- **Shape** (`packages/harness/src/skills/filesystem-source.ts:83-113`): a directory holding
  `SKILL.md` (any casing), fallback name = folder name; a flat `<name>.md` is legal; symlinks are
  followed; one level only.
- **Frontmatter** (`packages/core/src/skills/parse.ts:129`): name lowercased with a directory
  fallback; description; `when_to_use`; tool allow/deny lists; `user-invocable`;
  `disable-model-invocation`; and more, all optional. Validation
  (`packages/core/src/skills/validate.ts:89`) produces warnings only — nothing is ever rejected.
- **Precedence**: built-in < user < project (`packages/core/src/discovery/shadowing.ts:3-7`), proven
  repo > project-cloud > global > built-in
  (`packages/core/src/discovery/__tests__/cloud-skill-precedence.spec.ts:24`).
- **Listing** is a Volatile prompt fragment, not a tool description
  (`packages/harness/src/prompt/fragments/skills.ts:12-36`): one line per model-invocable skill,
  `- name: description Use when: ...`, per-description cap 1536 chars
  (`packages/core/src/skills/listing.ts:3`, `:24-33`), budget = context window × 4 × 0.03
  (`prompt/fragments/skills.ts:6-10`), shrinking by binary search, then dropping descriptions, then
  names only (`listing.ts:46-97`). Names are never dropped. Empty listing renders nothing.
- **`skill` tool** (`packages/harness/src/tools/builtin/skill.ts:91`): input `{name, arguments?}`,
  case-insensitive, refuses `disable-model-invocation`, expands `$ARGUMENTS`/`$1..$9`
  (`packages/core/src/commands/expand.ts:7-16`), and prepends a directory note when the skill has
  one (`skill.ts:82-89`) — the model is told every relative path below names a file in that
  directory.
- **`skill_install`** (`packages/harness/src/tools/builtin/skill-install.ts:32`): writes
  `<root>/<name>/SKILL.md` into the user or project layer (`install-writer.ts:40-51`). There is no
  `skill_edit`; editing is calling it again with a whole body.
- **Cloud storage**: `public.Skill` and `public.SkillFile` (`packages/db/src/prisma/schema/user-config/skill.prisma:2`,
  `skill-file.prisma:2`), edited through the API's `skills` router
  (`apps/api/src/api/cloud/skills/skills.router.ts:25-97`) and the catalogue
  (`apps/api/src/api/cloud/skill-catalogue/skill-catalogue.service.ts:31-128`). In a v1 sandbox the
  rows reach the pod as **file mounts** at `{ATLAS_HOME}/skills/<name>/<path>` and
  `{ATLAS_HOME}/project-skills/<name>/<path>` (`scoped-config.layers.ts:24-42`), swept on every
  cloud-state refresh (`apps/serve/src/file-mounts.ts:110-133`).
- **Built-ins** are compiled into the binary from `packages/harness/skills/` by
  `packages/harness/scripts/generate-skills.ts:40-46` (`manifest.generated.ts:15`); a built-in with
  bundled files is materialised under `<atlasHome>/bin/skills/<digest>/<name>/` on discovery
  (`mcp`-free path: `skills/embedded-source.ts:77`, `skills/bundle-materializer.ts:42-43`).

### 1.3 v2 — the seams that already exist

- **Plugin slots** carry everything both features need: `PodSlot.tools / hooks / prompts / commands /
  onDaemonEvent` and `PodControl` (`packages/plugin-sdk/src/slots.ts:42-77`), composed by
  `composePod` (`packages/plugin-sdk/src/compose-pod.ts:52-70`).
- **A plugin's tool set is a snapshot per held session today.** `pluginPodOf` builds a
  `ComposedPodRegistry` once from `plugins.pod.tools(ctx)` and validates duplicates in the constructor
  (`packages/host/src/holder/plugin-pod.ts:13-38`, `:81`, `:105-112`). The loop, however, re-reads the
  registry every step and again at settle: `held-runner.ts:193` passes `tools: () => pod.tools.declarations()`.
  So per-step freshness needs the **registry** to be live, not the loop to change (§3).
- **The daemon already speaks MCP.** `mcp.spawn / mcp.send / mcp.read / mcp.close / mcp.list` with
  `mcp.message` / `mcp.exited` frames (`packages/protocol/src/ops/mcp.ts:14-61`), implemented over
  `ManagedProcess` with a 10 000-line buffer and a 1 MiB event cap
  (`apps/daemon/src/ops/mcp/index.ts:12-110`), env scrubbed the same way v1 scrubs it, registered at
  `apps/daemon/src/ops/index.ts:17`. **Nothing above the daemon calls them.**
- **The host has the cipher and reads Postgres itself.** `SecretCipher`
  (`apps/agent-host/src/config/secret-cipher.ts:15`) already decrypts sealed model secrets
  (`config/model-config.ts:146-206`) and GitHub tokens
  (`tokens/github-token-reader.ts:9-13`), so unsealing `McpServer.sealedSpec` needs no new key.
- **Skills half-exist as a dead read.** `apps/agent-host/src/config/skill-index.ts:14` reads
  `Skill.name` / `Skill.description` for the user and the project into `AgentHostConfig.skills`
  (`config/agent-host-config.ts:31-42`) — and **nothing consumes it**: no fragment, no tool, no mount.
  `SkillFile` is deliberately not read (`config/__tests__/config-reader.spec.ts:145`).
- **The context slots and envelope text are already in `core`**: `EContextSlot.Skill`,
  `SkillListing`, `McpInstructions` with their provenance strings
  (`packages/core/src/context/slot.ts:3-11`, `context/envelope.ts:48-54`).
- **The model side already accepts a raw JSON schema**:
  `apps/agent-host/src/model/tool-set.ts:7-22` passes `declaration.jsonSchema` through
  `providerSafeSchema` with `strict: false`; its spec already uses an MCP-shaped declaration
  (`model/__tests__/tool-set.spec.ts:15-28`).
- **A journal redaction for `mcp.spawn` exists**: `packages/protocol/src/engine/call-store.ts:36`
  redacts the entry's `env` before persisting, pinned by
  `packages/protocol/src/engine/__tests__/journal-redaction.spec.ts:35-37`.

**No v2 code imports v1.** Per [0027](../decisions/0027-both-backends-own-their-work.md) and the
v1/v2 split guard (`scripts/check-package-split.ts`), the JSON-RPC client, the config parser and the
listing arithmetic are v2-native code inside the plugin, not imports from `packages/harness`. The
v1 files are the reference for behaviour, not a dependency.

## 2. Where the config lives — the decision this slice turns on

v1 has two homes for both features and they do not meet: on the operator's machine, files; in the
cloud, database rows pushed into the pod as files. v2 has one writer per piece of state
(architecture §4), so each source needs one owner.

| Feature                     | Source                                                                                  | v2 owner                                 | Read by                                                  | Recommended |
| --------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------- | ----------- |
| MCP, user + project rows    | `public.McpServer` (`sealedSpec`, `source = 'cloud'`)                                   | CP (rows), host (unseal)                 | the agent host at claim, refreshed at each turn boundary | yes         |
| MCP, repo files             | `.mcp.json`, `.atlas/mcp.json` in the clone                                             | the pod's workspace (git)                | the pod through the daemon's file port                   | yes         |
| Skills, user + project rows | `public.Skill` / `public.SkillFile`                                                     | CP (rows); the host reads **and writes** | the agent host, at claim and again per turn              | yes         |
| Skills, repo dirs           | `<repo>/.atlas/skills`, `<repo>/.agents/skills` (symlinks followed, `.claude` not read) | the pod's workspace (git)                | the pod through the daemon                               | yes         |
| Skills, built-ins           | compiled `SKILL.md` text                                                                | the plugin package                       | the plugin, no IO                                        | yes         |

The consequences, and what §10 asks the operator to confirm:
1. **Cloud rows are read by the host over its own Postgres, unsealed with the host's cipher** — no
   API call, which is what 0027 requires and what `skill-index.ts:14` already does for names. A row
   the operator edits in Settings therefore reaches a v2 session at the next turn, not the next session.
2. **A repo's own files are read inside the pod**, because that is where the clone is. It keeps the
   worked-on repo authoritative for the work it does — and it means a repo can add MCP servers and
   skills by committing them, exactly as in v1.
3. **Precedence stays v1's**: repo > cloud project > cloud user > built-in, and a disabled entry
   hides the name it repeats.
4. **A cloud skill is never copied into a pod.** The rows are the only copy: the body and every
   bundled file are served on demand (§5.2), so an edit in Settings reaches the running session and
   there is nothing to watch, sweep or sync. This is the one place the slice deliberately leaves v1,
   which mounts rows into the pod as files and deletes whatever the last mount did not write
   (`apps/serve/src/file-mounts.ts:110-133`).

## 3. The one contract change: a live tool source (PR 1, built)

Today `ComposedPodRegistry` snapshots a plugin's tools at claim
(`packages/host/src/holder/plugin-pod.ts:13-38`). MCP tool sets are discovered and change when a
server drops or gains tools, so the registry must ask the plugin again:
- `ComposedPodRegistry` takes `extras: () => readonly ToolDefinition[]` instead of a fixed array.
  It calls the supplier once in the constructor so a static duplicate still throws at claim (as
  today), then again on every `declarations()` and `find(name)`.
- A duplicate discovered after construction is not thrown — the turn must not wedge on a tool-list
  change — the later entry is dropped and the drop is logged through `PodControl.log`.
- `pluginToolsOf` (`plugin-pod.ts:71-81`) passes `() => plugins.pod.tools(args.ctx)`, so every
  plugin's tools become live with no per-plugin work.
- `packages/host/src/holder/crew/child-tools.ts:15-16` filters `base.declarations()`, so children
  inherit the new behaviour and ADR 0020's `childDeny` list keeps working unchanged.

Proof for this PR: a fixture plugin whose `tools(ctx)` returns a second tool after a flag flips is
offered on the next step and gone from the step after — the v2 counterpart of
`dynamic-tools.spec.ts:105-108` in v1 — plus a duplicate-name test for both moments (constructor
throws, later duplicate is dropped and logged).

## 4. `plugins/mcp`

### 4.1 Config and precedence (PR 2)

- Pure parser in the plugin's `/core`: entry shape, both transports, the `disabled` stub, both file
  envelopes and the Claude compatibility translation — a v2 copy of the rules at
  `packages/harness/src/mcp/config/specs.ts:13-113`, with the same name pattern so tool names stay
  valid.
- Sources, in this order: cloud user rows, cloud project rows, repo `.atlas/mcp.json`, repo
  `.mcp.json`; then `resolveShadowing`-style precedence (built-in < user < project, with the repo
  files ranked project and the cloud rows ranked by their own scope). A project entry that is a
  disabled stub hides the user entry it names — the v1 rule that makes the stub legal.
- Repo files are read through the daemon's file port at claim and re-read at each turn boundary (a
  pull mid-session changes the set). A parse failure is a rejection row in the view, never a throw.

### 4.2 Lifecycle (PR 2)

- **stdio servers run in the sandbox**, through `mcp.spawn` / `mcp.send` / `mcp.read` / `mcp.close`
  on the pod's daemon — this is why the ops exist and it keeps a server's process beside the code it
  serves. The entry's `env` is merged into the daemon's scrubbed base (`PATH`, `HOME`) exactly as v1
  does; the journal already redacts it (`packages/protocol/src/engine/call-store.ts:36`).
- **http servers are called from the agent host**, which is where `fetch` can reach a public URL.
  A server whose URL is only reachable inside the pod (`localhost`) is out of scope (§8) and reports
  `failed` with that reason.
- Connect happens once per held session before the first step, `allSettled`, with the 30 s ceiling;
  reconcile at each turn boundary under a 5 s budget, so a rescue claim re-uses the connections it
  can (`mcp.list`) instead of spawning a second process.
- A 401 is `needs-auth`; there is no sign-in flow in this slice (§8). Any other failure keeps the
  message — stderr is surfaced for the first 40 lines instead of being discarded, because v1's
  `stderr: 'ignore'` (`transport/stdio.ts:58`) is the single biggest reason a broken server is
  undiagnosable.

### 4.3 Tools (PR 2)

- One `McpBridgeTool` per `(server, tool)` with v1's name `mcp__<server>__<tool>`, description from
  the server, `inputSchema` a permissive record and `jsonSchema` the server's raw schema, so the
  model reads the real schema (`apps/agent-host/src/model/tool-set.ts:7-22` already supports it).
- Effect from the tool's `readOnlyHint` / `destructiveHint`, defaulting to `Write`; a `Read` tool is
  concurrency-safe. No MCP-specific approval gate and no per-tool allow list: v1 has none, and the
  operator's agent types and skills can deny by exact full name through the existing tool filter.
- Results: `structuredContent` preferred, text joined, images inline, other block kinds dropped with
  a named note, text capped at 30 000 characters — the same rendering rules, so a model that learned
  v1's shape sees no change.
- A call to an unconnected server answers `{ok: false, reason: "the '<name>' MCP server is not connected"}`.

### 4.4 Instructions and the view (PR 3)

- A `beforeTurn` hook emits a `context-loaded` in `EContextSlot.McpInstructions` the first time a
  server appears in a thread and a tombstone when it leaves — v1's behaviour, with its
  "third-party data, not instruction" envelope already in `core`.
- A `mcp` view (plugin view fold): one row per server — name, transport, status, tool count, reason,
  and the layer it came from — reachable in the session view like `services` and `shells` are. The
  web header chip and a settings surface are **not** in this slice; the existing v1 Settings pages
  keep editing the rows.
- A `mcp` pod command that returns the same rows as a notice (the v2 counterpart of `/mcp`,
  `packages/harness/src/composition/mcp-report.ts:15-43`), so a live check and a stuck operator have
  one way to ask.

## 5. `plugins/skills`

### 5.1 Sources and precedence (PR 4)

- **Built-ins**: the plugin's own `skills/` directory, compiled into the host the way
  `packages/harness/scripts/generate-skills.ts:40-46` compiles v1's — a generated manifest inside the
  plugin, no runtime IO for the text. The four v1 built-ins ship as-is; the skill files are copied
  into the plugin, not imported across the split.
- **Cloud rows**: `public.Skill` for `userId` and `projectId` plus `SkillFile` rows, read by the
  host's `ConfigReader` in the same call that already reads names
  (`apps/agent-host/src/config/skill-index.ts:14`). The index stops being dead: it becomes the listing.
- **Repo dirs**: `<repo>/.atlas/skills` and `<repo>/.agents/skills`, discovered through the daemon's
  file port — a directory holding `SKILL.md` (any casing) or a flat `<name>.md`, one level, symlinks
  followed (v1's rules, `packages/harness/src/skills/filesystem-source.ts:83-113`). `.claude/skills`
  is not a v2 root.
- Precedence: repo > cloud project > cloud user > built-in. Name is lowercased with a directory
  fallback; validation warns and never rejects (a rejected skill is a skill the operator already
  wrote, silently disappearing).

### 5.2 The listing and the load (PR 4)

- A `prompts` entry rendering one line per model-invocable skill, with v1's arithmetic: 1536-char
  per-description cap, budget = context window × 4 × 0.03, binary-search shrink, then drop
  descriptions, then names only. The fragment is Volatile and renders nothing when empty.
- `skill` (load): `{name, arguments?, path?}`. Without a `path` it returns the body, case-insensitive,
  refusing `disable-model-invocation`, expanding `$ARGUMENTS` / `$1..$9`. With a `path` it returns one
  bundled file of that skill — for a cloud skill the row's `SkillFile`, for a repo or built-in skill
  the file under its directory.
- The directory note that tells the model "every relative path below names a file inside that
  directory" is printed only for a skill with a real directory; a cloud skill's note says its files
  are read through the same tool with a `path`.

### 5.3 CRUD — install, edit and delete from a session (PR 5)

- `skill_install({layer, name, body})`, `skill_edit({name, layer, path?, body})` and
  `skill_delete({name, layer})`, with `layer` = `user` | `project` | `repo`.
- **Cloud writes go from the host to its own Postgres** (0027), with the semantics the API already
  enforces on the same rows (`apps/api/src/api/cloud/skills/skills.service.ts:98`): the description is
  derived from the `SKILL.md` just written, an edit carries the revision it was based on so a
  concurrent write is refused instead of lost, and a built-in cannot be overwritten.
- **Repo writes go through the daemon** into `<repo>/.atlas/skills/<name>/SKILL.md`; the file tools
  could do the same, and the tool exists so the frontmatter and the directory shape stay right.
- **The operator's surfaces do not change**: the Settings skills pages write the same rows, so a skill
  the model installs appears there and an edit made there is visible to the next turn. The one
  addition is a folder upload on that page (PR 6): drop a directory, each file becomes a `SkillFile`.
  v1 has no upload — the page creates and edits one file at a time.

## 6. Order, packaging and the PR sequence

Two plugin packages, no imports between them, both registered in
`apps/agent-host/src/registered-plugins.ts` and the two other registration lists (the API and web
compose the same plugin list; `mcp` is `transport: 'stream'` for its view, `skills` is
`transport: 'none'`).

| PR  | Contents                                                                                       | Proves                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | the live tool source (§3) — **built**                                                          | a plugin's tools change between steps; duplicates throw at claim, drop later                                                                                   |
| 2   | `plugins/mcp` `/core` + `/pod`: config, precedence, lifecycle, bridge tools                    | config from rows and repo files, a stdio server answers a call in a live-ish rig, precedence and a disabled stub                                               |
| 3   | `plugins/mcp` `/control` + `/client`: the `mcp` view, the instructions hook, the `mcp` command | status rows, instructions offered once, tombstone on drop, the command's report                                                                                |
| 4   | `plugins/skills` `/core` + `/pod`: sources, listing, `skill`                                   | precedence, listing budget, load with and without a directory                                                                                                  |
| 5   | `plugins/skills` CRUD: `skill_install` / `skill_edit` / `skill_delete` over rows and the clone | a cloud skill is created, edited and deleted from a session and Settings agrees; a concurrent edit is refused, not lost; a repo skill lands in `.atlas/skills` |
| 6   | folder upload on the Settings skills page, docs, and the live check (§8)                       | a dropped folder becomes a loadable cloud skill; the exit criterion, on production                                                                             |

The operator's live checks follow slice 7's practice: a fresh session (never one created during a
deploy — the stale-instance trap in `07-plugins.md` §8), recorded in §8 with the session id.

## 7. Test plan

- **Pure** (`plugins/*/src/core`): config parse and precedence tables, the listing arithmetic at
  budget, the effect mapping from hints, the name pattern, the disabled stub. No IO, no network.
- **Pod**: a fake daemon port that answers `mcp.*` and file reads, proving connect/reconcile/close,
  a failing server's status and stderr excerpt, tool naming, and the `skill` load from each source.
- **Host**: `ComposedPodRegistry` live-supplier spec (§3), and a `ConfigReader` spec for the
  `SkillFile` read (the existing one pins that names are read and files are not —
  `config/__tests__/config-reader.spec.ts:145` — so the new read must not weaken it: names stay in
  `AgentHostConfig.skills`, bodies are loaded on demand by the tool).
- **Protocol**: no change needed; `packages/protocol/src/ops/mcp.ts` already pins the ops.
- **Live** (§8): one production session per feature, plus a killed server.

## 8. Out of scope

- **MCP OAuth and sign-in.** No `needs-auth` flow, no loopback callback in the pod, no token
  refresh; a server needing auth shows `needs-auth` and says so. Wiring the v1 cloud grant path
  (`apps/api/src/api/cloud/mcp-oauth/`) into v2 is its own slice.
- **`mcp-edit` and any MCP write path from v2.** Settings edits the rows; the session reads them.
- **An MCP http server reachable only inside the pod** (a `localhost` URL). It needs a daemon-side
  http op, which this slice does not add.
- **A pod copy of a cloud skill, and any file watcher or sync to keep one in step.** Cloud skills
  are read from their rows on demand; nothing is installed into the pod.
- **`.claude/skills` as a repo root.** v2 reads `.atlas/skills` and `.agents/skills`; the Claude
  flavour stays v1 only.
- **Tools changing mid-turn without a turn boundary** for http servers: the reconcile runs at
  `beforeTurn`, so a server that mutates its own list mid-turn is seen on the next turn (v1 behaves
  the same way, `stdin`-level `tools/list_changed` being dropped).
- **Web UI beyond the plugin view and the one upload control**: no header chips, no new settings
  pages for MCP.

## 9. Live check (2026-11-10, production)

Session `f847bbe2-fd8e-41fa-a3af-ad9f230d6db3` (agent host 299, deploy `f4bcaeb4e`, which carries
#2150 and #2157), the operator's atlas project, one message per check.

**Skills.** The prompt carried a `Skills available to load:` block with a built-in (`atlas`,
`commit`), a repo skill from the clone's `.agents/skills` (`atlas-traces`) and the operator's cloud
rows (`better-layout`, `code-review`, ...). `skill` loaded one of each and told the model where the
bundled files are: the repo and built-in skills name their directory, a cloud skill says its files
come back through the same tool with a `path`. `skill_install` (user) wrote `live-check-echo` at
revision 1 — the row and its `SKILL.md` in `public.Skill`/`SkillFile` — and the next turn's listing
carried it; a `skill_edit` at `baseRevision 0` was refused naming revision 1 and its hash, the retry
at revision 1 answered revision 2; `skill_delete` removed the row, which the database then showed
gone. A `skill_install` with `layer: repo` wrote `<repo>/.atlas/skills/live-check-repo/SKILL.md` and
`skill_delete` removed the directory.

**MCP.** The two cloud rows arrive in the session with their layers — `Posthog` (project) and
`wispr-flow` (user), both http — and the project `.atlas/mcp.json` beats the cloud project row: a
`{"mcpServers":{"Posthog":{"disabled":true}}}` stub removed it from the roster while the user row
stayed. A Claude-compat `.mcp.json` stub does not hide it, by design. A stdio server named by the
clone's `.mcp.json` connected, `mcp__echo__echo` returned `echo: hello from the live check`, and its
`instructions` arrived in an `mcp-instructions` context block carrying v1's third-party envelope.
Killing it made the next call answer `the 'echo' MCP server rejected the call: the server was killed
by SIGTERM`; pointing its entry at a missing file made the roster show `failed` with
`the server exited with code 1 … Module not found`.

**Precedence.** A repo `opentui` shadowed the cloud user row of the same name: `skill` answered with
the clone's directory (`/atlas/workspaces/workspace/.agents/skills/opentui`), which a cloud skill
cannot do.

**The cloud servers, and their grants.** `Posthog` carries an active sealed OAuth grant (a token
valid to 2026-11-16), which Settings reads to show "Signed in"; `plugins/mcp` did not read
`oauthSealed`, so its http client sent no `Authorization` header and the row said `needs-auth`.
#2168 fixes that — the host unseals the grant and the http transport sends the bearer while the token
is unexpired — and the next live run connected it: the roster read `Posthog connected (1 tool)`,
`mcp__Posthog__exec` answered `info project-get` and then `call project-get {}` with live project data.
`wispr-flow` holds no grant at all, so `needs-auth` is still the truth there until the operator signs
in from Settings. Refresh of an expired grant (two agent hosts must not refresh one row at once) is
its own slice.

**Fixed because of this check** (#2157): a `description: >-` frontmatter block rendered as `>-` in
the listing; a skill installed mid-turn could not be loaded until the next turn; an MCP config entry
that failed to parse vanished from the view; a server's instructions arrived one turn after its
tools; a server killed mid-turn still read `connected` in the view.

## 10. Answers (2026-11-09)

1. **Both sources, the way v1 does it.** Cloud rows plus the json files: the rows are what Settings
   writes, the clone's files are what a repo commits, and `.mcp.json` / `.atlas/mcp.json` are read in
   the pod. §2 has the owner of each.
2. **Skills ship whole, not half: full CRUD.** Install, edit and delete from a session, cloud and
   repo; the listing and the load; **no pod copy of a cloud skill** — the rows are the only copy and
   their files are served on demand (§5.2), so there is no sync, no file watcher and nothing to
   sweep. Repo roots narrow to `.atlas/skills` and `.agents/skills` with symlinks followed; the
   Settings pages stay the operator's surface and gain a folder upload (§5.1-§5.3, PRs 4-6).
3. **A repo's MCP servers start without asking.** The clone is the operator's own repo; no approval
   surface is added, and `disabled: true` stays the only way to switch one off.
4. **The §2 table** is the source-owner split these answers confirm. Two things in it differ from
   v1 on purpose: a cloud skill never lands in a pod, and `.claude` is not a v2 repo root.

## Next

Slice 8, hardening and daily use, opens once these two plugins are live: the unread dot, the
credential-availability decision and the remaining audit items from slice 3's list.
