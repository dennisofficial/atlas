# Real cloud lift benchmark

This benchmark types `/container cloud` and `/container host` into the production App using OpenTUI's headless input driver. The harness, session stores, archive capture, Vercel SDK, persistent drive, released sandbox image, bootstrap, WebSocket attachment, and restoration are real. There is no model or provider stub.

## Run

From an Atlas worktree with `bun install` completed:

```sh
ATLAS_LIVE_CLOUD_BENCH=1 NODE_ENV=development bun run bench:cloud \
  --session=brn_YOUR_SESSION_ID \
  --source-home=/absolute/path/to/.atlas \
  --repository=/absolute/path/to/atlas \
  --runs=3
```

Artifacts default to `$ATLAS_SESSION_DIR/scratch`. Outside an Atlas session, supply `--output=/absolute/private/scratch/path`.

Optional `--image=...` selects a specific sandbox image. Otherwise the source user's configured/default development image is used; the report records it. This source-run benchmark does not claim the release pin of an installed `atlas` binary.

The repository must have a `main` branch. Its committed main checkout is cloned without hard links; a disposable linked worktree receives staged, unstaged, and untracked sentinels. This isolates the benchmark from real worktrees. The transcript can come from another project, but the result then measures that history paired with **Atlas's workspace/setup profile**, not the original project's environment.

## Isolation and timing

Each sample runs in a new process with a private Atlas home, new root/child IDs, and a fresh sandbox/drive name. Original history and repository files are read-only. Only credential/configuration seed files are copied; cloud sign-in and live process leases are not copied. Stale copied agent/process state is settled and the fixture's directory is normalized before timing begins.

Baseline samples lift idle history. They do not submit a prompt or resume historical work. Real inference can be tested separately; it is not part of provisioning latency.

The lift timer starts immediately before pressing Enter and ends after destination activation, local-worktree cleanup, and the authoritative owner binding. It does **not** stop at sandbox creation or ownership flip. Preparation of the duplicate and additional verification are outside the command timer.

`timeline.jsonl` records real SDK/mount, bootstrap, upload, portable/context capture, and completed relocation steps. Spans can nest or overlap: do not add concurrent upload durations or add bootstrap to its parent create span. SDK `getOrCreate` is a combined lookup/create operation, not a provider-only boot timer.

## Verification and artifacts

Successful samples must pass:

- Remote transcript identity checks for every copied thread.
- The same captured identities after descend.
- Staged, unstaged, and untracked workspace sentinel preservation and `git fsck`.
- An unchanged source-session file digest.
- Sandbox deletion after awaited teardown of the persistent drive.

`summary.json` reports individual durations and min/median/max. Three samples are a baseline, not a reliable tail-latency estimate. Failed samples are not included as successes, and later samples stop rather than hiding a failure.

`descendMs` measures the visible round trip: the command ends when the owner is bound back on the host and the transcript has been verified. The sandbox's asynchronous drive deletion continues in the background after the command settles. It is verified by the benchmark's explicit `cleanup` and `sandboxDeleted`/`driveDeleted` checks, but it is not included in the descend timer.

The git remote URL is copied from the source repository, but any URL containing credentials is refused before it lands in artifacts.

Private artifacts include the copied transcript, runtime logs, terminal frame, configuration and credential seeds. The output root is owner-only. **Do not commit or share that directory.** Failure retains the disposable home/workspace and names its sandbox for recovery; it does not modify or destroy the original session. Successful descend deletes the benchmark sandbox and drive, while local artifacts remain for inspection.

Unit checks do not provision:

```sh
bun test apps/tui/scripts/cloud-bench/__tests__
bun run --cwd apps/tui typecheck
```
