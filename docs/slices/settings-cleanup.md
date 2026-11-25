# Spec: v2 applies every setting it shows

Status: **approved by Dennis 2026-11-24** (decisions given through the V2 Feature Parity session).
Anchors are `path:line` at `31f78af1d`. Check an anchor again before you rely on it.

## 1. Product contract

v2 stores and shows settings that it does not apply. A setting that v2 shows must do what it says.
If v2 does not need the setting, Atlas deletes it. The v1 readers stay until the v1 deletion.

## 2. Decisions

| #   | Setting                                                                                                                                                                                                                                             | Result                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `context.filenames`                                                                                                                                                                                                                                 | Delete. v2 loads only `AGENTS.md` (root to project directory, plus nested). A symlink `AGENTS.md -> CLAUDE.md` is read through the link. A `CLAUDE.md -> AGENTS.md` link is not read twice. |
| 2   | `context.userInstructions`, `context.projectInstructions`                                                                                                                                                                                           | Delete both switches. The instruction text already reaches every v2 session. See §3.                                                                                                        |
| 3   | `context.reload`                                                                                                                                                                                                                                    | Delete. v2 already reloads (§4). Close one gap: an edit to the target of a symlinked `AGENTS.md` must also reload.                                                                          |
| 4   | `sandbox.image`, `context.autoCompact`, `decisions.*`, `execution.location`, `placement.lastBorn`, `container.*`, `experimental.pods`, `experimental.placementChooserShape`, `files.editor`, `dev.autoRestart`, `cloud.url`, `plugins.trustedRepos` | Delete from the core registry, the cloud registry, web, the TUI drawer and the docs.                                                                                                        |
| 4   | TUI look settings that `apps/tui` does not read: `transcript.smoothStreaming`, `transcript.thinkingBlocks`, `tldr.footer`, `tldr.status`, `sidebar.foldBelow`, `usage.meters`, `usage.warnFiveHour`, `usage.warnWeekly`, `notifications.seconds`    | Delete.                                                                                                                                                                                     |
| 4   | TUI look settings that `apps/tui` reads: `sidebar.width`, `transcript.imageRows`, `transcript.fenceWrap`, `appearance.accent`, `appearance.blockPadding`, `appearance.composerEdge`, `appearance.logo`                                              | Keep (`apps/tui/src/ui/appearance.ts:43-93`, `apps/tui/src/app/use-settings-panel.ts:65-77`).                                                                                               |
| 5   | `web.searchKey`                                                                                                                                                                                                                                     | No change in this spec. It waits for the web-search provider decision.                                                                                                                      |
| 6   | `quality.recordExamples`                                                                                                                                                                                                                            | Delete. Replace it with a PostHog event for each flagged Jev finding (§5).                                                                                                                  |

### v1 readers

v1 (`packages/harness`) still reads some of these ids, for example
`packages/harness/src/composition/instruction-plan.ts:28-47`. Their `ATLAS_SETTINGS` rows move out
of `packages/core/src/settings/registry.ts` into a v1-only definitions list in `packages/harness`,
next to `packages/harness/src/cloud/settings-definitions.ts`. v1 keeps working. v2, the web app and
the new TUI no longer show them. The v1 deletion removes the list. Ids with no reader at all are
deleted completely.

### Stored rows

No cleanup. Reading an unknown key never throws: `resolveSettings` puts it in `rejected`
(`packages/core/src/settings/resolve.ts:52-60`), and clients read only their own keys. The rows
stay in the database with no effect.

## 3. Personal and project instructions

The two switches do not hold text. They are on/off toggles (fallback on). In v1,
`context.userInstructions` turned off `~/.atlas/ATLAS.md` and `context.projectInstructions` turned
off the repository files (`packages/harness/src/composition/instruction-plan.ts:29-30`).

v2 has one concept for each kind of instruction:
- **Personal instructions** are the `UserFile` row `tree='instructions'`, `path='.atlas/ATLAS.md'`.
  You edit it on web Settings → Instructions (`apps/web/src/features/settings/pages/instructions.tsx`).
  The `instructions` plugin loads it into every session (`apps/api/src/agent/registered-plugins.ts:63-67`,
  `apps/api/src/agent/config/instructions.ts:16-29`). Sub-agents and teammates are sessions of the
  same user, so they get it too. It is the first system block, before the repository files
  (`plugins/instructions/src/pod/blocks.ts:5-9`).
- **Project instructions** are the repository `AGENTS.md` files.

We keep the `UserFile` because the web, Mac and mobile clients edit it already, and the v1
user-layer sync maps the same row to `~/.atlas/ATLAS.md`
(`packages/harness/src/user-layer-sync/tree-instructions.ts:19-33`). A switch adds nothing: to
turn personal instructions off, clear the text. Atlas Cloud has no project-level instruction text,
and this spec does not add one.

## 4. Reload

v2 already reloads instructions in the middle of a session:
- The `instructions` resource watches `AGENTS.md` under the project directory
  (`plugins/instructions/src/pod/resources.ts:98`). The daemon reports the change, the host reloads
  the resource, and `beforeStep` builds the system blocks from the latest snapshot at every step
  (`plugins/instructions/src/pod/hooks.ts:34-43`). The next step has the new text.
- The personal text has a version (row count and last update,
  `apps/api/src/agent/control/settings-versions.ts:32-36`). The host checks it at the start of each
  turn and reloads when it changed.

The gap: the daemon filters watch events by basename (`apps/daemon/src/ops/watch/index.ts:63-68`).
When `AGENTS.md` is a symlink to `CLAUDE.md` and you edit `CLAUDE.md`, the event path ends in
`CLAUDE.md` and the daemon drops it. Fix it in the daemon, for every watch: keep an event path when
a watched basename in the same directory is a symlink that resolves to that path. A target in a
different directory is out of scope. A symlinked directory is not walked, as today.

## 5. Jev examples in PostHog

Dennis wants to check that Jev flags real problems. The old setting wrote a JSON file into the
sandbox that nothing in v2 reads. The new design sends each flagged finding to PostHog, where the
routine "Quality: maintain Jev" labels precision.
- **Event** `quality example flagged`, one for each finding that produces the advisory note
  (`NotifiableEntry`, `plugins/quality/src/review/review-records.ts:14-21`), sent through the
  plugin's `ctx.analytics` (`packages/plugin-sdk/src/analytics.ts:11-13`).
- **Properties:** `policy_id`, `policy_version`, `status`, `impact`, `transition`, `concern_score`
  (`currentConcernProbability`), `finding_id`, `episode`, `path` (relative to the project
  directory), `scope_name`, `scope_kind`, `language`, `line_start`, `line_end`, `excerpt` (the
  scope's after text), `excerpt_truncated`, `classifier_model`.
- **Bounds:** the excerpt is at most 4 000 characters. No event for a path that `looksSecretShaped`
  matches (`.env`, keys, `.ssh` and more, `packages/core/src/policy/classifier/shapes.ts:62-69`),
  and no event when the excerpt `namesASecretLiteral`.
- **Only Dennis's code:** the API passes an allowlist of user ids from the env var
  `ATLAS_QUALITY_EXAMPLE_USERS` (comma separated, empty by default). A session whose owner is not
  on the list sends no example event. Production sets Dennis's user id.
- **Dashboard:** a "Jev examples" insight on the "Jev quality" dashboard
  (<https://us.posthog.com/project/411591/dashboard/2407147>) lists the recent events with these
  properties.

## 6. Slices

1. **Registry cleanup** (§2, §3): core registry, cloud registry, the v1 definitions list, web
   fields, the TUI drawer, docs and the built-in `atlas` skill references.
2. **Symlink-aware watch** (§4): `apps/daemon/src/ops/watch`.
3. **Jev examples** (§5): `plugins/quality`, `packages/core` exports, `apps/api` wiring, the
   PostHog insight.

## 7. Live check

On production: a session with personal instructions and a repository with a symlinked `AGENTS.md`
quotes both; an edit to the symlink target reaches the next step; the deleted settings are gone
from byatlas.io settings and the TUI drawer; a Jev review that flags a finding sends one
`quality example flagged` event.
