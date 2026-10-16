# Cloud birth: clone-only, no local state crosses

**Status:** proposal — dirty-checkout fork pending Dennis's ruling.
**Branch:** `dennis/cloud-born-clone` (worktree `.atlas/worktrees/cloud-born-clone`).

## Goal

A cloud-born session gets its workspace by **cloning from origin** inside the sandbox. No local
files, git state, worktrees, or uncommitted work cross over. The entire workspace tar
capture/upload/restore subsystem is deleted.

## Intent and constraints

- Born-placed is already shipped: the lift/descend move engine was deleted under GREENFIELD. The
  surviving transfer machinery has exactly one live caller — cloud birth.
- Dennis's ruling (2026-10-15): local state does not cross to cloud environments; start very
  simple, easy to maintain, iterate little by little, do not solve problems we don't have yet.
- Model is Amp's "orb": ephemeral, pre-cloned, no local workstation state pollution.
- Good codebase design is a requirement. The payoff here is deletion: the capture/upload/restore
  cluster fails the deletion test in the born-placed world — delete it and its complexity
  vanishes rather than reappearing across callers. What remains is one deep module, "ensure the
  workspace exists," behind a small interface, with clone as its only implementation.

## Out of scope

- Atlas Cloud control-plane (`apps/api`) — not traced; the birth path only calls its client
  endpoints (oauth handoff, registration, user-files), which are untouched.
- The `githubToken` park/rotation refresh gap (known, pre-existing; unchanged by this work).
- Dirty/unpushed-checkout preservation — explicitly not solved (see decisions).
- Syncing completed work back to the operator's machine — the agent pushes branches; no `descend`.

## Architecture after the change

A cloud birth carries exactly three things, all existing today:

1. **`workspace-spec.json`** — now the only workspace input. Its `remoteUrl` / `branch` /
   `commit` fields (currently always null on birth) are populated from the operator's local
   checkout, plus `githubToken` (from `gh auth token`) for the credentialed clone.
2. **Portable state** (`local-state.json`) — vault accounts, secrets, `settings.json`,
   `mcp.json`. Unchanged.
3. **OAuth handoff** via the Cloud API. Unchanged.

Skills, instructions, and memory continue to ride the user-layer sync (`/v1/user-files`) — they
never touched the workspace archive. There is no transcript at birth.

The serve-side boot keeps its existing `EnsureWorkspace` seam
(`apps/serve/src/materialize-workspace.ts:103`), which already clones credentialed, checks out
branch/commit, and disarms the token from the remote URL. It is promoted from never-exercised
fallback to the only path, and its descend-era patch/baseline machinery is deleted with it.

## Slices

Ordered. Each is independently shippable where noted, but 1–2 land together (the clone must be
correct before the archive is deleted). Slices link to `sections/NN-*.md` as they are scoped.

1. **Populate the spec at birth** — `cloud-birth.ts` fills `remoteUrl`/`branch`/`commit` from the
   local checkout instead of passing `workspace: null` + an archive.
2. **Harden the clone path** — full (not shallow) clone, correct branch/commit pinning, token
   scrubbing, failure surfacing. `materialize-workspace.ts` minus its patch/descend machinery.
3. **Delete the workspace archive** — capture (`packages/harness/src/workspace/transfer/`,
   ~3,900 LOC impl + ~5,000 LOC specs), upload transport, serve-side direct restore, family
   transfer modules, descend-only remnants, dead wire schemas.
4. **Rename out of "lift" vocabulary** — `liftNewborn`, `captureLiftWorkspace`, `preflightLift`,
   `CLOUD_LIFT_NOTICE_KEY`, the container-move overlay reused as birth progress.
5. **Docs** — rewrite `docs/architecture.md:1393-1563` (still describes lift/descend as live) and
   the stale descend prose in serve/tui comments.

## Decisions (see decisions.md)

- Clone-only; no local state crosses. Dirty/unpushed checkouts are not preserved.
- One fork deferred to Dennis: dirty checkout at cloud `/new` → **warn + clone tip** (recommended)
  vs **refuse**.
- `family-ownership` stays (session-local, seeded by `thread-store-history.ts`); the family
  *transfer* modules die with the archive.
- Work that never gets pushed dies with the sandbox drive (7-day retirement) — documented, not
  engineered around.

## Validation

- `bun run typecheck` and `bun test` green at each slice.
- Slice 2: a live-boot hand test — provision a sandbox from the worktree with
  `ATLAS_LIVE_DOCKER=1`-style gating, confirm the clone lands the pinned commit and `gh` works.
- Final: birth a real cloud thread from a clean checkout and from a sibling-worktree cwd; confirm
  identical results and no archive upload in the serve log.
