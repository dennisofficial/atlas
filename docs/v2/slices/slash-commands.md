# Slice spec: commands in v2 (kinds, surfaces, skills, arguments, the composer menu)

> **Approved by Dennis 2026-11-23.**

Status: **built 2026-11-23** (slices 1–6: #2577, #2580, #2587, #2586, #2585, #2590; the live-check fix #2594 runs a
typed `/resize` in the host; this docs slice closes it). Dennis's answers of 2026-11-23 applied, including the rewind picker rule. The TUI
work stays with slice 9 (§7). Anchors are `path:line` at
`1af03b6e3` (main, 2026-11-22). Re-check an anchor before you rely on it.

Operator (2026-11-22): "Slash commands were really weird and buggy. This needs to be a first-class
feature, so this needs careful planning." Operator (2026-11-18): typing `/name` to run a skill is
part of one v2 commands feature, not a skills-only shortcut.

Prior slices: [06-commands.md](06-commands.md) built the command contract and the three inbox
commands (rewind, summarise, rename) and **deferred the text layer to slice 9** ("No text layer
yet", 06-commands.md:179). [07b-mcp-skills.md](07b-mcp-skills.md) built skills and their pod
catalogue. [operator-input.md](operator-input.md) is the style this file follows.

---

## 1. Product contract

**Mental model.** A session takes input in one box. A line that starts with `/` and names something
Atlas knows is an **invocation**: Atlas does the thing and the model does not read it. Any other
line is a message to the model. There is one list of names, declared once. Each surface shows the
part of it that its own UI does not already do.

**Objects.**
- A **command** is a capability with arguments and one outcome: it either does the work or refuses
  with a sentence. It runs in the surface (open the model picker), on the agent host (rewind,
  summarise), or in the control plane (rename, resize).
- A **skill** is a folder of instructions in the repo, the cloud or the build. Typing its name
  loads its body into the turn and sends the operator's line as the message.
- A **catalogue** is the list the composer shows: every command a surface offers, plus every skill
  for this session.

**Main journey.**
1. The operator types `/`. The menu lists the catalogue for this surface, grouped, filtered by what
   they type after the slash. Enter or Tab completes the name; the argument hint stays visible.
2. The operator types the arguments and presses Send, or picks the entry and sends.
3. A skill: the operator's line appears in the transcript as a message, the skill body rides in the
   same turn, and the model answers.
4. A command: the typed line appears in the transcript as the operator's own message, marked as a
   command (§4.7). The outcome appears where the outcome lives (a new title, a lower meter, a
   rewound transcript), or a refusal shows the reason above the composer and can be dismissed.
5. A command that opens UI (the model picker) opens the surface's own picker. The command adds no
   second way to set the model.

**Success.** A typed line means the same thing on web, Mac, mobile and a future TUI: the host
parses it against the one registry, and a surface's menu never decides what the text means. A
command a surface does not list still runs when it is typed. A client one version old cannot send a
command to the model by mistake. A skill named `model` cannot make `/model` ambiguous. A refusal is
always a sentence, never a failed turn.

**Non-goals.** No chained commands (`/compact /model`). No per-surface parsing or dispatch: a
surface declares only what it lists and which client actions it implements. No second
model-selection path. No command that edits a running turn.

---

## 2. The v1 failure modes, and what prevents each

Each one was reported, fixed in v1, or left in the code. The design must make it impossible.

| #   | What happened                                                                                                                                                                                        | Evidence                                                                                                                                                                                                                                    | How the design prevents it                                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Each surface dispatched commands itself, with its own rules: web refused a mid-turn command, the TUI queued it, and a command a surface did not implement became "isn't available in the browser"    | `packages/core/src/commands/surface.ts:44-58` (`UNSUPPORTED`), `apps/web/src/features/threads/commands/dispatch.ts:22,57-59` (`SETTLED_WHILE_WORKING`), `apps/tui/src/composition/commands/dispatch.ts:61-72` (`EDispatch.Queued`), PR #358 | No surface parses or dispatches. The host does it (§4.4). A surface holds a display list and one action map for `client` commands. The display list never decides what text means                                                                   |
| F2  | A mid-turn command was refused into the turn's failure channel: a permanent red `✗ failed` transcript block, no dismiss, no retry                                                                    | PR #358 body: "used to be refused with a message routed into the conversation's failure channel — a persistent red `✗ failed` transcript block with no dismiss affordance and no retry"                                                     | A command is an inbox entry. The log holds success or one `input-refused{inboxId, reason}`. The web renders refusals from the log with a dismiss (`apps/web/src/features/sessions/refusal-rows.tsx`) and never as a failed turn                     |
| F3  | A typed command became a message to the model whenever the surface's list did not contain it — the state of v2 today                                                                                 | `apps/web/src/features/sessions/session-view.tsx:310` passes only skill entries to the composer, `:206-213` posts the text; `/model` therefore reaches the model                                                                            | The host parses every message before it becomes `user-said` (§4.4), against the full registry. A name that a surface hides from its menu still runs. A known name never reaches the model, whatever the client sent                                 |
| F4  | A name collision resolved by list order, silently: a skill shadowed a built-in of the same name; aliases worked but were invisible                                                                   | `packages/core/src/commands/resolve.ts:18-26` (a `Skill` replaces a held `Local`), PR #316 ("an alias is visible in the list rather than only working invisibly")                                                                           | One merge in one place (`catalogueOf`, §4.2): a command always wins, a shadowed skill is not listed, and duplicate command names throw at compose time (`packages/commands/src/registry.ts:29-31`). The host resolves in the same order as the menu |
| F5  | The grammar was shallow and the arguments untyped: a command only at column 0, up to 6 chained names, the argument a free string that each surface re-parsed, a failure shown as a raw toast message | `packages/core/src/commands/mention.ts:66-69`, `:74-80` (`MAX_CHAINED_COMMANDS`), `apps/web/src/features/threads/commands/web-command-handlers.ts` (`scopeOfArgument`, `instructionsOfArgument`), `dispatch.ts:71`                          | One parser and one zod schema per command (§4.3). Each command's `fromText` returns its own refusal sentence. Chaining is gone: one name, then free argument text                                                                                   |
| F6  | A queued command did not run at all, ran twice, or was rendered unlike what was typed                                                                                                                | PR #2381 ("A command waiting in the inbox only ran inside the next turn"), PR #2015 ("rerun a consumed command whose holder died"), PR #369 ("render a queued command the way the operator typed it")                                       | A typed command rides the ordinary message inbox entry, which is already crash-safe and re-drained by the next holder. The transcript row draws `command.text`, the exact typed line, so no renderer can invent its own wording                     |
| F7  | A refusal could land invisibly: while the page was closed, or when an older holder consumed a kind it did not know during a deploy                                                                   | PR #2011, PR #2017, and 06-commands.md:381-387                                                                                                                                                                                              | Unchanged machinery, now also used by text commands. Every refusal is `input-refused` on the entry's own `inboxId`                                                                                                                                  |
| F8  | The menu could list a skill the pod did not have: repo skills were read from GitHub, and the control plane could not read `skills-changed`                                                           | PR #2326 ("stop reading repo skills from github"), PR #2327 (pod pushes repo skills to the v2 slash menu), PR #2328                                                                                                                         | The names in the menu come from the pod's `skills-changed` event, and the host resolves `/name` against the pod's own catalogue. The list and the resolution are the same source                                                                    |
| F9  | Completion depended on the menu having rendered (TUI)                                                                                                                                                | PR #1394 ("complete a command on tab even before the menu has rendered")                                                                                                                                                                    | Completion is `catalogueForSurface(catalogueOf(...))` + text, a pure function of the input. No rendered row is consulted                                                                                                                            |

---

## 3. Dennis's answers

1. **Q2, what a typed command leaves in the transcript.** The operator's own message, marked as a
   command — not a quiet `Ran /x` row. Researched in §4.7; the design follows Claude Code for the
   line and Claude Code and Zed for the outcome.
2. **Q3, an unknown `/name`.** Sent as a message. A path or quoted text that starts with `/` must
   stay a message, so a refusal would make that impossible to express.
3. **Q4, layers of commands.** Four kinds, named in §4.1: client-only, host, skills, and
   plugin-declared. Each surface declares the part it offers (§4.2).
4. **Q5, one set per surface.** A command that is only a UI shortcut is not offered where the UI
   already does it. The set is a declared table, not a filter in a component (§4.2).
5. **Q1, the target of `/rewind`.** `/rewind` with no argument always opens a picker that asks which
   line to rewind to. The quick path is `/rewind`, up, enter, enter. The TUI works this way today and
   stays unchanged (§4.6). A surface whose own UI does not pick does not offer the command (§4.2).
   `/summarise` opens no picker: the TUI has no `/summarise` command today, so the rule does not
   apply to it, and it keeps the default of "up to your last message" (§4.6).

---

## 4. Design

### 4.1 `packages/commands`: one contract, four kinds

`packages/commands` is the shared foundation (0019) and the only place a command is declared. It
stays pure (core + zod).

**The kinds.** Two independent facts, both explicit:

| Kind Dennis named | `runsIn`  | `source`  | Example                              |
| ----------------- | --------- | --------- | ------------------------------------ |
| client-only       | `client`  | `builtin` | `/model`, `/help`                    |
| host              | `host`    | `builtin` | `/rewind`, `/summarise`              |
| control           | `control` | `builtin` | `/rename`, `/resize`                 |
| plugin-declared   | any       | `plugin`  | a command a plugin adds              |
| skill             | —         | `skill`   | a folder in the repo, cloud or build |

`runsIn` says where the work happens. `source` says who declared it. A plugin command is not a
fourth runtime; it declares `runsIn` like a builtin one, so nothing downstream branches on its
origin. A skill is not a `CommandSpec` at all: its names are data from the pod (§4.5).

**`CommandSpec`** (`packages/commands/src/spec.ts:4-11` today) becomes:

```ts
export type CommandRunsIn = 'client' | 'host' | 'control'
export type ClientAction = 'model-picker' | 'command-list'

export type TextArgs = { ok: true; args: unknown } | { ok: false; reason: string }

export type CommandSpec = {
  name: string
  summary: string
  group: CommandGroup
  argumentHint?: string | undefined
  args: z.ZodType
  runsIn: CommandRunsIn
  fromText?: (argumentText: string) => TextArgs
  opens?: ClientAction
}
```

- `handledIn: 'holder' | 'control'` becomes `runsIn` with the third value. `'host'` is the holder
  process (`packages/host/src/holder`), which is the agent host. `byInboxKind` keeps only
  `runsIn === 'host'` (`registry.ts:25-36`, unchanged rule).
- `timing` is deleted. It existed so a client could refuse a mid-turn command (F1); the inbox
  already orders every entry behind a running turn (`packages/host/src/holder/inbox-intake.ts:145-182`)
  and runs pending commands when no turn runs (`:120-143`). Delete `ECommandTiming` from the spec
  and from `model-set.ts:15-24`, `resize/spec.ts:17-26`.
- `fromText` is how a typed argument becomes `args`. A command with no `fromText` accepts no
  argument text and refuses one with "`/<name>` takes no arguments". Each command owns its
  sentences, as rewind already does (`commands/src/rewind/spec.ts`, `REFUSAL_*`).
- `opens` is required when `runsIn === 'client'`, and forbidden otherwise (`defineCommand` throws).

**`CommandEntry`** — the catalogue row a client displays (new `packages/commands/src/entry.ts`):

```ts
export type CommandEntry = {
  name: string
  summary: string
  group: CommandGroup
  argumentHint?: string | undefined
  kind: 'command' | 'skill'
  source: 'builtin' | 'plugin' | 'skill'
  opens?: ClientAction
}

export const entryOf = (command: Command): CommandEntry
export const skillEntryOf = (skill: { name: string; description: string; argumentHint: string | null }): CommandEntry
```

### 4.2 One catalogue, and a declared set per surface

`catalogueOf` merges commands and skills, and is the only place F4 can be decided:

```ts
export const catalogueOf = (input: {
  commands: readonly CommandEntry[]
  skills: readonly CommandEntry[]
}): readonly CommandEntry[]
```

It drops a skill whose name matches a command, sorts by group and name.

**The surface table** (new `packages/commands/src/surface.ts`) is the one declaration of what each
surface shows. It is a table of names and reasons, not a filter inside a component:

```ts
export type Surface = 'web' | 'mac' | 'mobile' | 'tui'

export type SurfaceProfile = {
  surface: Surface
  hides: readonly { name: string; because: 'message-action' | 'panel' }[]
  picks: readonly { name: string }[]
}

export const SURFACE_PROFILES: Record<Surface, SurfaceProfile>

export const catalogueForSurface = (input: {
  entries: readonly CommandEntry[]
  surface: Surface
}): readonly CommandEntry[]
```

| Surface  | Hides                                                   | Picks    |
| -------- | ------------------------------------------------------- | -------- |
| `tui`    | `summarise` — its rewind drawer summarises up to a line | `rewind` |
| `web`    | `rewind`, `summarise` — message actions do them         | none     |
| `mac`    | the same as `web` — Mac runs the web client             | none     |
| `mobile` | the same as `web`                                       | none     |

A **picked** name is the one name whose no-argument form the surface's own UI answers first: the
surface opens its picker and posts nothing, then posts the line the operator chose. The host never
chooses a target, and the shared catalogue never replaces a surface's picker.

`skills`, `mcp` and `shells` join the table in slice 9, when the TUI is the first surface that
needs them: they are `client` commands that open a panel, and web, Mac and mobile hide them there.
The table never names a command that does not exist (§6).

Three rules make this safe:
- **A hidden name still works when typed.** Hiding is a menu decision only. The host parses against
  the full registry (F3), and a hidden client command still opens its panel. Nothing refuses text
  because a surface does not list it.
- **Client actions are enforced by the compiler, not by a filter.** Each surface's action map is
  typed `Record<ClientAction, …>`. A new client command adds a `ClientAction`, and every surface
  that has not implemented it fails typecheck. A surface cannot silently lack an action.
- **A picked name is the surface's own picker.** The TUI is the only surface that picks a command
  today, and only because it already has the picker (§4.6). A surface that picks a name must draw
  the picker; the host's no-argument form is a refusal, never a guess.

### 4.3 The text layer

New `packages/commands/src/text.ts`:

```ts
export type Invocation =
  | { kind: 'message' }
  | { kind: 'command'; command: Command; args: unknown }
  | { kind: 'skill'; name: string; argumentText: string }
  | { kind: 'refused'; name: string; reason: string }

export const parseInvocation = (input: {
  text: string
  commands: CommandRegistry
  skills: readonly string[]
}): Invocation
```

Rules, in order:
1. Read the first line only. The slash must be at column 0 (a leading space makes it a message).
2. The scan reuses v1's shape — a mention is `/` + `[a-z][a-z0-9-]*` ending at whitespace or the end
   of the line, and a name inside a code span is not a mention (`packages/core/src/commands/mention.ts:26-60`).
   Copy that scanner into `packages/commands`; the v1 copy dies with v1.
3. A name in neither set → `message`. This keeps `/usr/bin/env is missing` a message, and it is
   Q3's answer.
4. A command name → `fromText(argumentText)`, or `{args:{}}` when it declares none. A `fromText`
   that returns `{ok:false}` → `refused` with its sentence. Never a message.
5. A skill name → `{kind:'skill'}`. The argument text is everything after the name.
6. No chaining. Everything after the name is argument text.

**Client commands** (new `packages/commands/src/client.ts`):

```ts
export const clientActionOf = (input: {
  text: string
  commands: CommandRegistry
}): ClientAction | null
```

It is `parseInvocation` minus skills, and it returns the action only when the name resolves to a
`runsIn: 'client'` command. A surface calls it before it posts, so `/model` opens the picker and
nothing is sent. This is the only place a client decides anything, and it decides nothing about
state.

### 4.4 Where the parsing runs: in the host, on the message entry

The host parses, not the client. Reasons: the composed registry and the pod's skill names live
there; a stale client cannot misroute; one code path serves every surface.

**New pure planner** (`packages/host/src/holder/text-command.ts`):

```ts
export type TextPlan =
  | { kind: 'message' }
  | { kind: 'command'; command: Command; handler: CommandHandler<unknown>; args: unknown; name: string; argumentText: string; text: string }
  | { kind: 'skill'; name: string; argumentText: string }
  | { kind: 'refused'; reason: string }

export const planTextInput = async (input: {
  message: InboxMessage
  commands: CommandRegistry
  handlers: CommandHandlers
  slash?: PodSlash | undefined
}): Promise<TextPlan>
```

`skills` for the parser comes from `slash.names()` (§4.5). A command with no handler in the map is
`refused` ("This session cannot run /name yet.") rather than sent as a message. A `client` command
typed as text is refused with "/name opens in the app. Pick it from the / menu."

**Control commands in the host** (correction, slice 2). A `control` command such as `rename` has no
pod handler, so the host also takes `controlHandlers` (by name) and runs them with its own
`ControlPlane`: `nativeControlHandlers` is passed in `apps/api/src/agent/compose.ts`. `resize` runs in
the host too: the host is given the same handler the API runs, `podResizeHandlerOf` in
`apps/api/src/_lib/pod-resize/pod-resize-handler.ts`, wired beside `nativeControlHandlers`, so a
typed `/resize 2 4` works on every surface. Only `model-set` stays API-only, and a typed `/model-set`
is refused with the sentence above. While a
typed command waits behind a turn, the status rows show it as a queued message with the typed text,
not as a command row (those rows key off `command:` inbox kinds).

**The branch.** `drainEntries` handles `INBOX_KIND_MESSAGE` at
`packages/host/src/holder/intake-entries.ts:52-56` by staging the message. It calls the planner
first:
- `command` → append `input-consumed{inboxId, consumed: Command, command:{name, argumentText, text}}`,
  then run the handler with the existing `CommandContext` (`packages/host/src/holder/command-intake.ts:123-150`).
  A refusal appends `input-refused{inboxId, reason}` and nothing else. No `user-said` is written.
- `skill` → append `input-posted`, then the skill's `context-loaded` draft, then
  `user-said{inboxId, text}` — the order v1 proved (`packages/harness/src/loop/__tests__/say-expansion.spec.ts:25-32`).
- `refused` → `input-refused`.
- `message` → today's path, unchanged.

`stage()` (`staged-log.ts:94-100`) keeps writing `input-posted` for the message before the drain, so
the pending row appears at once. `input-consumed` is the record that the entry became a command.

**Record change** (`packages/core/src/record/event.ts:68` + schema `:135-138`):
`input-consumed` gains `command?: { name: string; argumentText: string; text: string }`. It is
optional, so old rows stay valid. `text` is the exact line the operator typed, which is what the
transcript row shows (F6). A command run from an affordance has no `command` field and stays
silent.

### 4.5 Skills: one slot, one implementation

A skill name is not a fixed spec, so it cannot be a `Command`. The framework owns ordering,
refusals and the message; the skills plugin owns what a skill is.

`packages/plugin-sdk/src/slots.ts` (PodSlot, `:116-124`) gains one field, built per pod like
`tools(ctx)`:

```ts
export type PodSlash = {
  names(): Promise<readonly string[]>
  load(input: {
    name: string
    argumentText: string
  }): Promise<{ ok: true; drafts: readonly EventDraft[] } | { ok: false; reason: string }>
}

export type PodSlot = {
  // …
  slash?: ((ctx: PluginPodContext) => PodSlash) | undefined
}
```

`composePod` (`packages/plugin-sdk/src/compose-pod.ts:9-17`) exposes `slash(ctx)`, merging at most
one contribution (two plugins that answer slash names throw, as `mergeMaps` does today).

`plugins/skills` implements it (`plugins/skills/src/pod/slash.ts`): `names()` is the pod catalogue's
names; `load()` reads the body with the code the `skill` tool already uses
(`plugins/skills/src/pod/skill-tool.ts:222-241`), expands `$ARGUMENTS` and `$1` with
`expandSkillBody` (`plugins/skills/src/core/expand.ts:7-16`), and returns
`context-loaded{slot:'skill', key:name, content:body}` plus the tool's note line. The same refusal
sentences as the tool: an unknown name, an unreadable body.

Why a slot and not a fixed `skill` command: the names are data, and the pod is the only place that
knows them. The alternative — a fixed `command:skill` with `{name, args}` — still needs the host to
know the names to parse `/review src`, so it moves the problem and adds a second name space.

### 4.6 The commands that come back

Native (`commands/src`), all declared once and served to every surface:

| Name        | `runsIn` | Text form                                                                                          | Today                                          |
| ----------- | -------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `rewind`    | host     | `/rewind <seq>`; no argument opens the surface's picker, and is refused where the surface has none | `commands/src/rewind/spec.ts`, `pod.ts`        |
| `summarise` | host     | `/summarise [seq]`; no argument = up to your last message; no picker                               | `commands/src/summarise/spec.ts`, `pod.ts`     |
| `rotate`    | host     | `/rotate [instructions]`; writes a handoff brief and starts the next request from it; no picker    | `commands/src/rotate/spec.ts`, `pod.ts`        |
| `rename`    | control  | `/rename <name>`                                                                                   | `commands/src/rename/spec.ts`, `control.ts`    |
| `resize`    | control  | `/resize <vcpus> <memoryGb> [diskGb] [--idle]`                                                     | `commands/src/resize/spec.ts` (API-only today) |
| `model`     | client   | `/model` — opens the model picker, no argument                                                     | new, `commands/src/model/spec.ts`              |
| `help`      | client   | `/help` — opens the command list                                                                   | new, `commands/src/help/spec.ts`               |

**The TUI's rewind picker, which v2 must keep.** The TUI draws the picker itself today, and the
whole interaction is client-side:
- The command opens the drawer and ignores its argument text: `ECommand.Rewind` maps to
  `opens(handlers.onRewind)` (`apps/tui/src/composition/commands/registry.ts:129`), and the entry has
  no `argumentHint` and echoes nothing (`packages/core/src/commands/catalogue.ts:103-109`).
- Opening reads the transcript and builds the rows (`apps/tui/src/composition/use-rewind.ts:36-46`).
  `openRewind` takes the operator's own messages, newest first, and starts on the newest
  (`apps/tui/src/ui/rewind-model.ts:74-80`). With nothing said, it returns `null` and no drawer opens
  (`apps/tui/src/composition/__tests__/app-rewind.spec.tsx:99-110`).
- Up and down move the row, then the verb, once a verb is chosen (`use-rewind.ts:88-90`,
  `rewind-model.ts:123-134`). Enter with no verb picks the first verb, `rewind to here`
  (`use-rewind.ts:71-81`); Enter again resolves the choice and hands it to the caller
  (`use-rewind.ts:83-85`), which puts the message back in the composer
  (`apps/tui/src/composition/__tests__/app-rewind.spec.tsx:114-133`).
- The drawer offers rewind to here, summarise up to here and fork from here on a message, and only
  the rewind on a compaction row (`rewind-model.ts:99-110`). Summarising up to a line is a verb of
  this drawer, not a command; the TUI has no `/summarise` (`packages/core/src/commands/catalogue.ts:4-23`).

So `/rewind`, up, enter, enter is the quick path, and it stays. In v2 the TUI declares itself as the
surface that picks `rewind` (§4.2), keeps the drawer, and posts the chosen line as `/rewind <seq>`.
The shared `rewind` command therefore requires a target, and a surface with no picker refuses a typed
`/rewind` with the command's own sentence instead of choosing a line for the operator.

`model` is a client row next to `model-set`, not a replacement: the picker posts
`sessions.command{name:'model-set'}` through the same path it uses today
(`apps/web/src/features/sessions/data/use-session-model-choice.ts:13,36-37` →
`apps/api/src/api/platform/control/model-set.ts:9-24`). The model stays pinned per session, chosen
once per change, on every surface.

`resize` joins `nativeCommands` (`commands/src/index.ts:11`) so it is declared in one list; its
control handler is shared by the API and the host (`apps/api/src/_lib/pod-resize/pod-resize-handler.ts`).

**Served once.** `apps/api/src/api/platform/control/command-registry.ts:16-17` already composes the
one registry (`nativeCommands` + `model-set` + `resize` + `composedPlugins.commands`). Add
`commandCatalogue()` beside it: `nativeCommands` marked `source: 'builtin'`,
`composedPlugins.commands` marked `source: 'plugin'`. New query `sessions.commands` on
`apps/api/src/api/platform/control/sessions.router.ts` (beside the `command` mutation at `:209-214`)
returns `{ commands: readonly CommandEntry[] }` with no arguments: the registry is the same for
every session. The client filters it with `catalogueForSurface`. Skills are not in it — the pod owns
them, and the client already receives them (`plugins/skills/src/client/index.ts:30`). The generated
router is committed (slice 6 §10), so this PR commits it.

**Dropped, with the reason:**
- `/compact` — v2's summary model is "everything before a message"; it has no whole-history form
  (`packages/core/src/record/summary-target.ts`).
- `/settings`, `/auth` — the account menu already does it, on every surface.
- `/cd`, `/container`, `/resume`, `/new`, `/wake`, `/exit`, `/restart` — no v2 counterpart: a
  session has one sandbox for one project, sessions are rows in a sidebar, and web, Mac and mobile
  have no process to exit or restart.

Existing as message actions, unchanged: rewind, summarise, rename.

### 4.7 What the operator sees

**Research: how other tools draw a typed command.** Documents only; no screenshot was inspected.

| Tool                    | What its own docs say the transcript holds                                                                                                                                                                                                                                            | Source                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Claude Code             | A command is "only recognized at the start of your message"; the typed line stays your message, and an output such as `/release-notes` "appears in your transcript without entering the conversation Claude sees"; a bad name reports "Unknown command" instead of becoming a message | code.claude.com/docs/en/commands                    |
| OpenAI Codex (CLI, app) | Type `/` in the composer and pick; an active goal shows a progress row above the composer, not a transcript row. The CLI pages do not describe how a typed command is drawn in the transcript                                                                                         | learn.chatgpt.com/codex/reference/slash-commands    |
| Cursor                  | Commands are typed in the chat input; some are pure UI (`/side` and `/btw` open a side chat, `/goal` sets a goal). The docs do not state how the typed command is drawn                                                                                                               | cursor.com/docs/agent/overview                      |
| GitHub Copilot Chat     | `/` commands are "shortcuts for frequently used prompts"; a `!` command keeps the typed line, and "the command output and exit status appear in the chat transcript" without going to the agent                                                                                       | code.visualstudio.com/docs/chat/copilot-chat        |
| Aider                   | In-chat commands are CLI actions, not model messages: `/git` output is "excluded from chat", `/run` adds it only when asked                                                                                                                                                           | aider.chat/docs/usage/commands.html                 |
| opencode                | A command expands its template and arguments "before submitting a durable user prompt", so the transcript shows the expanded prompt, not the name; `/btw` answers open in a dialog and stay out of the conversation                                                                   | opencode.ai/docs/commands, opencode.ai/docs/cli/tui |
| Zed                     | Typing `/compact` puts a distinct, expandable "Context Compacted" entry in the thread                                                                                                                                                                                                 | zed.dev/docs/ai/agent-panel                         |

**The design.** The typed line stays in the transcript as the operator's own message, and it is
marked as a command: the command name in mono with the accent colour, a small command glyph in place
of the avatar, the argument text at normal weight, and no bubble background change. It sits at the
operator's side of the transcript, in the same column and with the same timestamp as a message. The
outcome is a separate, quiet entry where an entry is needed (a refusal), or nothing at all where the
outcome lives elsewhere (a new title in the sidebar, a lower meter).

It follows **Claude Code** for the operator's line and the "output is in the transcript but not in
the model's conversation" split, and **Zed** and **Copilot Chat** for a distinct entry for output
that must be seen. It does not follow **opencode**, which hides the command name by submitting only
the expanded prompt: Atlas must show what was typed, and the model must not read it.

**Rendering.** `packages/client/src/stream/transcript-events.ts:50-58` drops `input-consumed` today.
Change that case: keep `input-consumed` when it carries `command`, drop it otherwise (an affordance
command stays silent). The event then reaches the fold with its position in the timeline. Add one
component, `apps/web/src/features/sessions/command-message-row.tsx`, and its mobile twin; both read
`event.command.text` and never rebuild the line from `name` and `argumentText`. Mac and mobile get
the row from the shared fold.

**Menu.** `apps/web/src/features/threads/thread-composer.tsx:22,37` takes
`entries: readonly CommandEntry[]`. Filtering, Enter/Tab completion and the argument hint keep the
v1 shape (`use-command-menu.ts`, `command-menu.tsx`) on the new row type. The list is
`catalogueForSurface({entries: catalogueOf({commands: fetched, skills: cloud + repo}), surface: 'web'})`.

**Pending.** `CommandRows` (`apps/web/src/features/sessions/command-rows.tsx:7`) already shows a
running or queued command from its `input-posted` kind, with the same typed text. The pending row
becomes the transcript row without a change of wording (F6).

**Refusal.** The existing `RefusalRows` (`apps/web/src/features/sessions/refusal-rows.tsx`): one
sentence, dismissable, survives a reload.

**`/model`.** The picker opens; the session row follows the announced model. `/help` opens the list
with every entry of this surface's catalogue.

### 4.8 Packages and boundaries

- `apps/web` and `apps/mobile` add `@dltech/atlas-commands` (pure: core + zod). They already
  depend on `@dltech/atlas-core` (`apps/web/package.json:16`, `apps/mobile/package.json:24`).
- No v1 type crosses into v2: `CommandGroup` is declared in `packages/commands`, and v1's
  `ECommandGroup` (`packages/core/src/commands/spec.ts:6-10`) is mapped in v1's adapter only.
- The host imports no plugin. `apps/api/src/agent/compose.ts` (the agent host's composition) passes `composedPlugins.pod.slash`
  into `InboxIntakeArgs` beside `commands` and `handlers`
  (`packages/host/src/holder/inbox-intake.ts:51-64`).

---

## 5. Slices

Each slice is one PR that merges alone; later slices need the earlier ones only where stated.

**1. `refactor(commands): one contract, four kinds, one set per surface`**
Files: `packages/commands/src/{spec,registry,entry,surface,text,client,index}.ts`,
`packages/commands/src/__tests__/`; `commands/src/{index.ts,rewind/spec.ts,summarise/spec.ts,rename/spec.ts,resize/spec.ts}`;
`apps/api/src/api/platform/control/{command-registry.ts,model-set.ts,sessions.router.ts}`.
Kinds, parser, catalogue merge, the surface table, the `sessions.commands` query, `timing`/`handledIn`
removed. No behaviour change on any surface.

**2. `feat(commands): run a typed command in the host`** (needs 1)
Files: `packages/host/src/holder/{text-command.ts,intake-entries.ts,command-intake.ts,inbox-intake.ts}`,
`packages/core/src/record/{event.ts,command-entries.ts}`, `packages/client/src/stream/transcript-events.ts`,
`apps/api/src/agent/compose.ts`.
The planner, the message branch, `input-consumed.command.text`, the refusal, the transcript case
kept for command-bearing rows. Typed `/rename bench` works through `sessions.post` with no client
change — this is the proof that a stale client cannot misroute.

**3. `feat(web): one menu for commands and skills`** (needs 1; 2 for the transcript row)
Files: `apps/web/src/features/sessions/data/{use-session-commands.ts,session-skills.ts}`,
`apps/web/src/features/threads/{thread-composer.tsx,commands/*}`,
`apps/web/src/features/sessions/{session-view.tsx,command-message-row.tsx}`,
`apps/web/src/features/threads/use-thread-commands.ts`.
Catalogue fetch and merge, the `'web'` surface profile, `/model` interception, `/help`, the command
message row, the composer prop change with v1's adapter.

**4. `feat(skills): type a skill name to load it`** (needs 2)
Files: `packages/plugin-sdk/src/{slots.ts,compose-pod.ts}`,
`plugins/skills/src/pod/{slash.ts,index.ts}` + specs, `apps/api/src/agent/compose.ts`.
The `slash` slot, the skills implementation, `context-loaded` then `user-said`.

**5. `feat(commands): rewind needs a line, summarise takes your last`** (needs 2; independent of 3 and 4)
Files: `commands/src/{rewind,summarise}/{spec.ts,pod.ts}` + specs.
`rewind` takes a required `toSeq` and refuses an empty argument with its own sentence; `summarise`
keeps an optional `throughSeq` that defaults to your last message, with a refusal when there is
nothing to act on. No picker is built here: the TUI drawer supplies the line (slice 9).

**6. `feat(mobile): the command menu in the phone composer`** (needs 1 and 3's contract)
Files: `apps/mobile/src/thread/v2/*`, `apps/mobile/src/composer/*`, `apps/mobile/package.json`.
The same catalogue, the `'mobile'` profile and the same client actions in the phone's composer
(`apps/mobile/src/thread/v2/use-v2-session-screen.ts:90` posts today), with the mobile command row.

**7. `docs(v2): the commands feature`**
Files: this file, `docs/v2/roadmap.md`, `docs/v2/slices/06-commands.md:179` (the "no text layer"
paragraph is now history).

---

## 6. Test plan and live check

**Pure (`packages/commands`)**
- `parseInvocation`: a command at column 0; a leading space, a code span, an inner slash and an
  unknown name all stay messages; a skill name resolves with its argument text; a command whose
  `fromText` refuses returns its sentence; no chaining.
- `catalogueOf`: a skill that collides with a command is dropped; ordering by group then name;
  `defineCommand` throws on a duplicate name, on a `client` spec without `opens` and on a non-client
  spec with one.
- `catalogueForSurface`: `'tui'` hides `summarise` and picks `rewind`; `'web'`, `'mac'` and
  `'mobile'` hide `rewind` and `summarise` and pick nothing; every hidden and every picked name
  exists in the registry (a stale table entry fails the test); a hidden name still parses as its
  command, never as a message.
- `clientActionOf`: `/model` and `/help` return their actions; a host command returns `null`.

**API**
- `sessions.commands` returns every composed command once, tagged `builtin` or `plugin`, and never a
  skill; `sessions.command` still refuses an unknown name and bad args (`postCommand`,
  `command-registry.ts:32-43`).

**Host**
- A message entry whose text is `/rename bench` appends `input-consumed{consumed:Command,
  command:{name:'rename', argumentText:'bench', text:'/rename bench'}}` and no `user-said`; the
  title changes.
- A hidden command typed on web still runs: `/rewind` from a posted text rewinds, although the web
  menu does not list it.
- A message entry whose text is `/model` appends `input-refused` with the sentence, and no
  `user-said`.
- A message entry whose text is `/rewind` with no argument, posted from a client with no picker,
  appends `input-refused` with `rewind`'s sentence and no `user-said`; the same text from the TUI's
  picker always carries a seq.
- `/review src/app.ts` appends `input-posted`, then `context-loaded{slot:'skill'}` with the expanded
  body, then `user-said{text:'/review src/app.ts'}` — in that order.
- A command posted while a turn runs waits for the turn and then runs once (the #2381 path).
- A command whose holder dies after `input-consumed` re-runs once (the #2015 path).
- A skill slot that throws, or a pod catalogue that cannot be read, leaves the text a message and
  logs a warning.

**Client fold (`packages/client`)**
- `input-consumed` with `command` survives the transcript fold at its timeline position;
  `input-consumed` without `command` is dropped.

**Web**
- The composer lists commands and skills together; a skill whose name matches a command is not
  listed; `/rewind` and `/summarise` are not listed, and a typed `/rewind` shows the refusal;
  `/model` opens the picker and posts nothing;
  `/help` opens the list with every entry of the web set; `/rename x`
  posts the text once and shows one operator row reading `/rename x` exactly; a refusal shows with a
  dismiss and survives a reload; reloading a thread draws the same row from the log.

**Live check** (one real v2 session on production, after slice 5):
1. Type `/model`, pick another model: the session row changes, no message is sent.
2. Type `/rename bench`: the sidebar title changes and your typed line appears as your own message,
   marked as a command.
3. Type `/summarise`: the history up to your last message becomes one summary; no picker opens.
4. Type a skill name with an argument: the model answers as if it had called `skill`, the
   transcript shows the typed line.
5. `curl` a `sessions.post` with `{text:"/rename curl"}`: the rename happens, proving the host
   parsed it and the model never saw it.
6. Type `/nope`: the model reads it as a message.
7. Send a command during a turn: the pending row appears with the typed text, the command runs after
   the turn, once, and becomes one operator row.
8. On the TUI (after slice 9), type `/rewind`, then up, enter, enter: the drawer picks the line above
   the newest, the message returns to the composer, and the rest of the drawer works as it does
   today.

---

## 7. Out of scope

- A picker for `/summarise`, and a rewind picker on web, Mac and mobile: the message action picks
  there, and the TUI keeps the drawer it has.
- Chained commands, aliases, and per-command argument autocompletion beyond the hint string.
- Commands that act on a running turn (stop and queue-edit stay where they are).
- Skills invoked from an affordance (a skill button) rather than by text.
- Any TUI build: slice 9 consumes `SURFACE_PROFILES`, the catalogue and the action map, and declares
  `/skills`, `/mcp` and `/shells` there if it needs them. It keeps the rewind drawer and its composer
  unchanged, and it picks `rewind` as the table says.
- v1: unchanged. v1's `packages/core/src/commands/` dies with v1; nothing here imports it.
