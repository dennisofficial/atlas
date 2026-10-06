---
name: atlas-cloud
description: Explain and troubleshoot Atlas Cloud, lift and descend, /container cloud, Vercel sandbox setup, Cloud sign-in and backup, workspace transfer, disconnected or parked sessions, preview URLs, and cloud logs. Use when asked where Atlas runs, what survives a move, or how to operate a remote session.
---

# Atlas Cloud

Use this guide without an Atlas source checkout. Establish location, connection, and transcript
freshness first; these instructions describe behavior, not live state. Load `atlas-config` for configuration.

## Establish the location

Read workspace and execution reminders; `/atlas/workspaces/<repo-name>` alone does not prove location.
The operator's `/container` reports location, and the terminal chip shows connection state. Name what you cannot inspect.

- The terminal client renders the conversation and provisions sandboxes with the operator's Vercel credentials.
- The sandbox runs the harness, model requests, tools, shells, and services. Its drive persists session data.
  Closing or losing the terminal does not stop remote work.
- The optional Atlas Cloud backend handles identity, remote control, thread discovery, PR/CI notifications,
  provider OAuth renewal, and configuration backup. It does not provision sandboxes or proxy model requests.

## Setup and operator controls

In `/settings` (`ctrl+o`) select cloud. Set the Vercel token through the secret-setting UI, plus
`sandbox.vercelTeamId` and `sandbox.vercelProjectId` (also `VERCEL_TEAM_ID` and `VERCEL_PROJECT_ID`).
The token uses Atlas's secret store, not a Vercel environment variable. Keep it out of conversation text.
An Atlas Cloud sign-in is not required for API-key-based execution; provider OAuth needs handoff below.

Atlas reads `gh auth token` locally when first bootstrapping a sandbox. Missing credentials can leave
it without GitHub access. Authenticate locally before lifting. A later local `gh auth login` does not
update an existing sandbox; verify its Git access and arrange sandbox authentication if needed.
Released builds select a matching image; prefer that default. `sandbox.image` / `ATLAS_SANDBOX_IMAGE`
overrides it for image-access debugging or an intentional runtime. Quota and billing belong to the operator.

The operator types these slash commands in Atlas, not in a shell:

| Input                                 | Effect                                           |
| ------------------------------------- | ------------------------------------------------ |
| `/container`                          | Report current execution location                |
| `/container cloud`                    | Lift the conversation to a cloud sandbox         |
| `/container off` or `/container host` | Return to host; a cloud session descends         |
| `/container docker`                   | Use local Docker; a cloud session descends first |

`execution_location` switches host/Docker only. There are no `/lift`, `/descend`, park, or wake commands.
Moves may wait or refuse for compaction, a prior unfinished move, or a connecting sandbox.
Shells and services stop rather than migrate; restart what is needed at the destination. Only running
shells trigger confirmation. Turns move at a clean pause, not by migrating an active process.

## What a lift preserves

Atlas pauses the family before capture, verifies the destination, commits ownership, and resumes.
A pre-commit failure keeps the source authoritative; stopped local processes may need restarting.

- Conversations and supervised threads travel with their event identities.
- The primary repository's main checkout and the session's own worktree carry covered staged,
  unstaged, and untracked files and logical Git state. No user commit or push is required.
  Other linked worktrees stay behind. Include Git-ignored files with `.atlas/.cloudinclude`
  (one glob per line, `#` comments) when they need workspace transfer.
- A context bundle carries user skills, global instructions, user MCP configuration, memory/project
  memory, and project-local instruction files. Above 256 MiB Atlas warns and omits the whole bundle.
  An upload failure instead fails the lift before ownership changes; check which outcome occurred.
- Copyable API-key accounts, ordinary secrets, and user settings carry through portable state.
  Provider OAuth and MCP OAuth have the restrictions below.

After verified lift, Atlas removes the local session worktree only if its fingerprint matches capture.
A changed tree stays with a warning. Atlas does not remove the main checkout.
Sibling clones under `/atlas/workspaces` are ephemeral: descend leaves them behind, and sandbox
destruction deletes their copies. Preserve their work outside the sandbox before descending.
User settings travel at lift and follow local changes while attached. Change them on the terminal;
sandbox-side edits do not flow back. Cloud backup is a separate explicit operation.

## Descend and preserve data

`/container off` returns verified history and workspace; invalid history cannot replace the local conversation.
If the local checkout changed independently, Atlas restores into a suffixed worktree instead of overwriting or merging.

Descend refuses registered checkouts outside the covered roots, including a teammate's separate
worktree, and names their paths. Preserve the work first. With operator authorization and after
checking for uncommitted/unpushed work and active owners, `git worktree remove <listed-path>` inside
the sandbox unregisters an omitted worktree. Do not force removal. Pushing alone, or deleting only
the directory, does not clear the registration check. A coverage refusal leaves processes running;
a descend that proceeds stops sandbox shells and services before packing.

Confirm ownership with `/container`, not an attachment error's wording: failed restore/attach keeps the source local.
After ownership commits, later problems arrive as a completed lift with a warning. Use `ctrl+r` to reconnect;
`/container cloud` when already there only reports location. Preserve source files/logs; avoid destructive retries.

## Cloud sign-in, credentials, and backup

The cloud settings page offers device-code sign-in, sign-out, GitHub connection, and explicit upload
or download of accounts, secrets, user settings, and MCP configuration. Restore merges local data:
same-named secrets, MCP entries, and settings keys may be overwritten, while other local data remains.
Memory is not a Cloud backup domain; it travels with session context.

Sign-in, backup, restore, and lift preparation can hand eligible Atlas-native Claude/Codex OAuth grants
to Cloud's refresh authority. Sandboxes use assigned short-lived access tokens, not provider refresh
tokens. Local-only or legacy CLI-imported grants need native authorization/handoff. MCP OAuth stays
local and is excluded from portable credentials. Follow omission notices rather than assuming every
login works after lift. Use `/auth` for provider sign-in and `/mcp signin <name>` for local MCP sign-in;
choose sandbox-compatible MCP authentication for Cloud. Signing out does not return OAuth refresh
authority to the local client; cached tokens can work until expiry, but renewal still needs authority.

## Connection, parking, and previews

Keep sandbox lifecycle, client connection, and transcript freshness separate. Disconnection can
leave the sandbox working while the terminal shows old history. Reopening through `/resume` or
sending input can wake a parked session; `ctrl+r` retries disconnected attachment.
With no outstanding work, a sandbox parks after about five idle minutes. Turns, children, shells,
or queued input block parking. Services prevent parking while a client is attached; detached
service-only sessions may park after about thirty quiet minutes, stopping those processes.
A parked drive preserves data, not processes. Runtime replacement uses Atlas's drain/checkpoint
procedure; a timeout is not permission to destroy a live sandbox.

Signed-in startup may retire registered sandboxes whose last recorded activity exceeds seven days,
including destroying their drives. Descend or preserve work before leaving it unused. Parking is
not indefinite storage; signed-out sessions also retain Vercel billing and storage responsibilities.
For previews, use `service_start` with `exposePort`, bind to `0.0.0.0`, and hand over the returned URL.
`localhost` is the sandbox, not the operator's machine. Up to fifteen ports can be exposed, including
Atlas's serve port. Use background `bash` for finite jobs. Restart services after sandbox recreation.

## Diagnose with evidence

Read `/atlas/home/operational/atlas-serve.log` for persistent Cloud diagnostics; older runtimes may
use `/opt/atlas/atlas-serve.log`. User skills live in `/atlas/home/skills`, `/atlas/home/.agents/skills`,
and `/atlas/home/.claude/skills`; prefer `skill_install` over the sandbox's ordinary home.
Host Atlas home holds global `logs.jsonl` (including driver/wake narration) and `sessions/<id>/logs.jsonl`
(including lift diagnostics). Inspect relevant errors without dumping credentials or sensitive headers.
For setup failures, inspect the Vercel settings, image access, or quota named by the error. For Git
failures, check the sandbox's authentication. Distinguish oversized context warnings from upload failures.
For transfer refusals, preserve named checkouts. For stale history, inspect connection and serve logs
before declaring an agent failed. Report the notice, location, and redacted evidence; ask for operator-side checks if needed.
