---
name: atlas
description: Handbook to the Atlas harness: set up a repo or home for Atlas, configure and troubleshoot settings.json, ATLAS_HOME, instruction files (ATLAS.md, AGENTS.md, CLAUDE.md), skills, agent types, MCP servers (mcp.json, .mcp.json), .atlas/services.yaml (services_ensure, preview URLs, PORT), .atlas/container.json, Dockerfile and devcontainer, plugins, worktrees, Atlas Cloud sandboxes, /container, parked sessions and cloud logs.
---

# Atlas

Atlas is a model-agnostic coding-agent harness. It runs the agent loop itself, with Claude, Codex or other
providers behind it. The terminal app (TUI) and Atlas Cloud are two surfaces over the same harness: a session
has the same hooks, tools, prompts and configuration wherever its loop runs (host, local Docker, or a cloud
sandbox). These pages describe mechanisms, not the live state of this session: establish the project directory
and Atlas home first. Atlas home is non-empty `ATLAS_HOME`, otherwise `~/.atlas`.

All paths below are relative to this skill's directory when they start with `references/`.

## Set up a repository for Atlas

Create only what the repo needs; each item is optional and commit the shared ones.

1. Instructions: `AGENTS.md` (or `CLAUDE.md` / `ATLAS.md`) at the repo root; `*.local.md` siblings stay uncommitted.
2. `.atlas/settings.json`: repo-wide settings overrides.
3. `.atlas/mcp.json`: MCP servers for this repo; no secrets in it.
4. `.atlas/services.yaml`: dev servers and APIs the agent should run and expose.
5. `.atlas/container.json` (or `.atlas/Dockerfile`): the image and setup for Docker execution.
6. `.atlas/skills/`, `.atlas/agents/`: repo skills and agent types.
7. `.atlas/plugins/`: hooks, tools and prompt fragments, as TypeScript.
8. Worktrees need no setup: Atlas creates them under `.atlas/worktrees` and writes its own `.gitignore` there.

## Every file Atlas reads

| File | Scope | Page |
| --- | --- | --- |
| `<atlas-home>/settings.json`, `.atlas/settings.json` | user, project | `references/config.md` |
| `<atlas-home>/mcp.json`, `.atlas/mcp.json`, `.mcp.json` | user, project | `references/config.md` |
| `<atlas-home>/ATLAS.md`, `AGENTS.md`, `CLAUDE.md`, `ATLAS.md`, `*.local.md` | user, project | `references/config.md` |
| `skills/` and `agents/` under `<atlas-home>`, `~/.agents`, `~/.claude`, and the project's `.atlas`, `.agents`, `.claude` | user, project | `references/config.md` |
| `.atlas/services.yaml` | project | `references/services.md` |
| `.atlas/container.json`, `.devcontainer/devcontainer.json`, `.atlas/Dockerfile`, `<atlas-home>/Dockerfile` | project, user | `references/container.md` |
| `<atlas-home>/plugins/`, `.atlas/plugins/` | user, project | `references/plugins.md` |
| `.atlas/worktrees/` | project | `references/worktrees.md` |
| Cloud sign-in, sandbox settings, backup | user | `references/cloud.md` |

## Pages

Read the page for the task; do not load them all.

| Page | Covers |
| --- | --- |
| `references/config.md` | Settings, instruction files, skills, agent types, MCP, verifying a change |
| `references/services.md` | `services.yaml`, `services_ensure`, `service_start`, URLs, framework host allow-listing, crash loops |
| `references/cloud.md` | Placement, Vercel sandbox setup, `/container`, sign-in and backup, parking, cloud logs |
| `references/container.md` | Docker image resolution, `container.json` fields, setup recipe |
| `references/plugins.md` | Writing and installing plugins |
| `references/worktrees.md` | `enter_worktree`, `exit_worktree`, `worktree_list` |

## Ground rules

- Do not dump `auth.json`, `secrets.json` or credential values; inspect key names only.
- Slash commands (`/settings`, `/mcp`, `/skills`, `/container`) are typed by the operator, not run in `bash`.
- Make the smallest edit, validate it, then say which file changed and how it activates.
