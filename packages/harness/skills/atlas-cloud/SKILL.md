---
name: atlas-cloud
description: Explain and troubleshoot Atlas Cloud, born-placed threads, /container, Vercel sandbox setup, Cloud sign-in and backup, parked or disconnected sessions, preview URLs, and cloud logs. Use when asked where Atlas runs or how to operate a cloud session.
---

# Atlas Cloud

Use this guide without an Atlas source checkout. Establish placement, connection, and transcript
freshness first; these instructions describe behavior, not live state. Load `atlas-config` for configuration.

## Establish the placement

Every thread is born-placed: it starts where it was created — the cloud when the machine can
provision a sandbox, the host otherwise — and it never moves. Read workspace and execution
reminders; `/atlas/workspaces/<repo-name>` alone does not prove location. The operator's
`/container` reports the thread's placement, and the terminal chip shows connection state. Name
what you cannot inspect.

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
it without GitHub access. Authenticate locally before starting a cloud thread. A later local
`gh auth login` does not update an existing sandbox; verify its Git access and arrange sandbox
authentication if needed. Released builds select a matching image; prefer that default.
`sandbox.image` / `ATLAS_SANDBOX_IMAGE` overrides it for image-access debugging or an intentional
runtime. Quota and billing belong to the operator.

The operator types these slash commands in Atlas, not in a shell:

| Input                                 | Effect                                                            |
| ------------------------------------- | ----------------------------------------------------------------- |
| `/container`                          | Report where this thread was born and runs                        |
| `/container off` or `/container host` | Switch a host-born thread's tool environment back to the host     |
| `/container docker`                   | Switch a host-born thread's tool environment to local Docker      |
| `/container resources`                | Resize a cloud sandbox's vCPUs live                               |

`/container cloud` is not a move: threads are born-placed, so on a host-born thread it refuses and
suggests starting a new thread — with cloud configured, new threads are born in the cloud. The same
refusal answers `/container off|host|docker` on a cloud-born thread. `execution_location` switches
host/Docker only — docker is an execution location; cloud-vs-local is placement, fixed at creation.
There are no `/lift`, `/descend`, park, or wake commands.

## What a cloud birth carries

A cloud-born thread's sandbox boots from the local machine's bootstrap: user skills, global
instructions, user MCP configuration, memory/project memory, and project-local instruction files
ride the context bundle; copyable API-key accounts, ordinary secrets, and user settings carry
through portable state. Provider OAuth and MCP OAuth have the restrictions below. The workspace is
cloned fresh in the sandbox at `/atlas/workspaces/<repo-name>` — sibling clones under that root are
ephemeral: sandbox destruction deletes them, so preserve their work outside the sandbox.

## Grandfathered threads

Threads created before born-placed sessions keep the location they already have: a legacy local
thread stays local and can still switch host/docker through `execution_location`; a legacy cloud
thread keeps working exactly as before (park/wake/reattach). None of them can ever move — the
answer to wanting the other placement is a new thread.

## Cloud sign-in, credentials, and backup

The cloud settings page offers device-code sign-in, sign-out, GitHub connection, and explicit upload
or download of accounts, secrets, user settings, and MCP configuration. Restore merges local data:
same-named secrets, MCP entries, and settings keys may be overwritten, while other local data remains.
Memory is not a Cloud backup domain; it travels with session context.

Sign-in and backup can hand eligible Atlas-native Claude/Codex OAuth grants to Cloud's refresh
authority. Sandboxes use assigned short-lived access tokens, not provider refresh
tokens. Local-only or legacy CLI-imported grants need native authorization/handoff. MCP OAuth stays
local and is excluded from portable credentials. Follow omission notices rather than assuming every
login works in a cloud-born thread. Use `/auth` for provider sign-in and `/mcp signin <name>` for
local MCP sign-in; choose sandbox-compatible MCP authentication for Cloud. Signing out does not
return OAuth refresh authority to the local client; cached tokens can work until expiry, but renewal
still needs authority.

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
including destroying their drives. Preserve work before leaving it unused. Parking is
not indefinite storage; signed-out sessions also retain Vercel billing and storage responsibilities.
For previews, use `service_start` with `exposePort`, bind to `0.0.0.0`, and hand over the returned URL.
`localhost` is the sandbox, not the operator's machine. Up to fifteen ports can be exposed, including
Atlas's serve port. Use background `bash` for finite jobs. Restart services after sandbox recreation.

## Diagnose with evidence

Read `/atlas/home/operational/atlas-serve.log` for persistent Cloud diagnostics; older runtimes may
use `/opt/atlas/atlas-serve.log`. User skills live in `/atlas/home/skills`, `/atlas/home/.agents/skills`,
and `/atlas/home/.claude/skills`; prefer `skill_install` over the sandbox's ordinary home.
Host Atlas home holds global `logs.jsonl` (including driver/wake narration) and `sessions/<id>/logs.jsonl`.
Inspect relevant errors without dumping credentials or sensitive headers.
For setup failures, inspect the Vercel settings, image access, or quota named by the error. For Git
failures, check the sandbox's authentication. Distinguish oversized context warnings from upload failures.
For stale history, inspect connection and serve logs
before declaring an agent failed. Report the notice, location, and redacted evidence; ask for operator-side checks if needed.
