# Thin system prompts handoff

## Resume here

Continue in `/atlas/workspace/.atlas/worktrees/thin-system-prompts`, branch
`dennis/thin-system-prompts`. Draft PR: https://github.com/dennisofficial/atlas/pull/958.

Dennis wants all prompt-review batches in this one PR. Keep it draft and unmerged
until the whole review is complete. The CI watch was stopped at his request.
The main checkout is read-only. Do not create another PR or tear down this worktree.
This note is a temporary session handoff, not permanent architecture documentation;
remove it when the review is complete.

## Agreed direction

- Use affirmative instructions / positive framing. Give the desired action in a
  short instruction, rather than prohibitions, explanations, or generic coaching.
- Keep system instructions stable. Changing an early system token can invalidate
  reuse of the entire following conversation, including hundreds of thousands of
  tokens. Frequently changing worktree/location facts belong in runtime context.
- Review remaining fragments in small batches. Show proposed text in fenced blocks
  for Dennis to review. Implement agreed text as the discussion progresses.
- Verify implementation claims against current code rather than trusting old prompt
  wording. `packages/harness/src/prompt/AGENTS.md` records this authoring guidance.
- File whole-read and staleness guards protect concurrent sessions. Keep enforcement
  and just-in-time refusal guidance; avoid repeating their procedure in system prose.
  Anchored edits already accept partial reads; file-wide staleness still blocks them.
- Remove generic request-handling guidance entirely (confirmed after first commit).
- Remove always-on compaction prose. Continuation context accompanies the summary.
- Keep a minimal identity, one skill-roster preamble, concise external-source guidance,
  and explicit automatic notifications for shells/services/sub-agents/teammates.

## Cloud semantics Dennis clarified

- Harness locations: local or cloud. Agent execution environments: host, Docker, cloud.
- Host + Docker splits the local harness from command/file execution in Docker.
  Current MCP transports remain attached to the harness; they are not Docker-routed.
- Cloud means Atlas itself, its harness, and tools run together inside an isolated
  Vercel machine. The terminal is a client. The developer cannot directly manipulate
  that remote worktree through their local filesystem.
- Each new cloud session has its own isolated environment. Resuming the same session
  continues its persisted workspace; a handoff creates a new session/environment.
- No supported upload/file-transfer feature should be invented in prompt text.
- Cloud-specific explanation is one conditional runtime reminder outside system text.
- The currently injected old sandbox reminder may still describe read-only gitconfig
  mounts; do not infer new code correctness from that production reminder.

## Implemented

First commit: `7c8dfbea7 fix(prompt): thin system prose and stabilize runtime transitions`.

- Removed file-guard, full-read, no-confirming-reread, compaction, relative-path, and
  current-directory system fragments. Retained a short tracked-file-tools preference.
- Shortened identity, skills preamble, notification and external-source instructions.
- Removed the browser same-site/cookie guarantee from Docker prompt and exposure result.
- Replaced volatile execution-location system prose with stable high-level topology.
- `worktreeBlock` now supplies project/worktree facts as a user-role tail reminder;
  `executionLocationBlock` supplies host/Docker/cloud facts similarly.
- Removed worktree-note unconditional permission to commit/push.
- Guarded new runtime reminders from concealing an invalid completed assistant tail.
- Tests use actual location events and preserve 121 durable messages plus system
  cache metadata byte-for-byte across host/Docker transitions.
- Updated architecture prose only where this batch changed prompt/cache intent.

Final handoff commit removes the remaining request-handling fragment and adds the
agreed cloud isolation/access/resume-vs-handoff wording, with matching tests.

## Verification

Before final wording: full core suite 2,113 passed; prompt/assembly/loop/child integration
checks passed; core/harness/TUI/serve typechecks passed; root binary build passed;
compiled binary version and boot smoke tests worked. Root chmod-denial tests failed
because root can read restricted files; rerunning 30 permission-sensitive tests as
`nobody` passed. No guard implementation was relaxed.

After final wording: `ATLAS_HOME=/tmp/atlas-thin-prompts-handoff bun test
packages/harness/src/prompt packages/core/src/assembly` passed 338 tests. Diff check clean.
CI results have not been used to merge. Recheck current status when ready to ship.

## Next review batch

No next-batch implementation has begun. Read current fragments and propose only a
manageable group, such as checklist, delegation, destructive actions, and Git etiquette.
Remaining material includes:

- `packages/harness/src/prompt/fragments/scope.ts`: concern, pace, open questions,
  plan-first, developer decisions still verbose/unreviewed.
- `plan.ts`, `agents.ts`, `safety.ts`, `output.ts`: remaining policy/style prose.
- `packages/harness/src/agents/types/built-ins.ts`: child role contracts.
- `packages/core/src/memory/prompt.ts`: roughly 1,051-word memory authoring essay.
- `packages/harness/src/prompt/fragments/models.ts`: Kimi text-answer reminder still
  falsely says a summariser supplies an answer; current loop nudges once, then fails.
- Auxiliary prompts in harness/model/{summariser,titler,tldr}.ts and core policy
  classifier modules. Session titler uses structured `name`, not bare text.
- Bash/tool descriptions are large too; moving prose into them is not token reduction.
- Installed skill roster is much larger than bundled skills and scales to 3% of model
  context. Listing-budget/discovery changes remain undecided.

## Separate implementation issues found (not fixed)

1. **Worktree preservation:** Dennis says switching host/Docker must preserve the active
   worktree and mount it live at the same path. Current location events clear active
   worktree/home/repo state in `packages/core/src/workspace/worktree.ts`. Docker mount
   configuration caches the launch anchor in composition/sandbox-binding.ts, rather
   than preparing the currently selected worktree. Fix reducers and mount readiness
   together; current prompt tests deliberately assert the existing reset.
2. **Child questions:** both ordinary sub-agents and teammates should ask the owning
   parent, end the turn, and resume gated work only on its answer. Teammates can already
   `report_to_main`; ordinary children are refused. `agent_say` can restart stopped
   children. No explicit awaiting-parent-answer state exists; unrelated notices can
   wake them. These contracts must be implemented before promising them in prompts.
3. **Native Atlas previews skill:** Dennis proposed on-demand builtin guidance based
   on legacy preview prompting, rather than global browser/config essays. Not built.
   Legacy named-service URLs/proxy code is under deprecated/backend/src/host_old/exposure;
   legacy preview prose is deprecated/backend/src/_shared_old/prompt-kit/system/fragments.ts.
   Active URLs are per port: Docker sandbox.localhost proxy; cloud sandbox.domain(port).
   Children including teammates currently lack service_start/service_stop tools.
4. **Cloud Git identity diagnosis (read-only ask):** apps/serve/src/environment-profile.ts
   launches git-identity and gpg-signing in Promise.all (around line 250). Identity writes
   user.name/email (169-172), while profile-gpg.ts writes signingkey/gpgsign (85-88), all
   to the same .git/config. Losing the config.lock race produces the exact observed
   `could not lock config file .git/config: File exists` and null identity in capabilities.
   compose-serve.ts closes over the boot capability snapshot; there is no live re-probe.
   A later boot may succeed. Serialize the Git-config writers and test the concurrent
   case if Dennis authorizes fixing it; do not disguise this as prompt text.
5. **Compaction input:** default event payload clipping is 600 characters, and the
   renderer omits agent-reported events. Prompts cannot preserve omitted constraints.
6. **Stale removed context:** instruction/memory loaders don't retire context when
   files disappear; prior loaded events can survive. Not part of implemented batch.

Avoid revisiting AWS credential operations for this task. The screenshot showed an
agent requesting credential JSON in the remote worktree, but the authorized work is
cloud-context wording, not handling secrets.
