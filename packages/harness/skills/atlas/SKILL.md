---
name: atlas
description: "Handbook to the Atlas harness: set up a repo or home for Atlas, configure and troubleshoot settings.json, ATLAS_HOME, repo instructions (AGENTS.md) and Cloud personal instructions, skills and agent types under .agents, MCP servers (mcp.json, .mcp.json), .atlas/services.yaml (service_start, needs, preview URLs, PORT), plugins, worktrees, Atlas Cloud sandboxes and their project setup script and secrets, /container, parked sessions, cloud logs, and OAuth sign-in callbacks from a preview through callback.byatlas.dev."
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

1. Instructions: `AGENTS.md` at the repo root, and nested `AGENTS.md` files where a directory needs its own. Only that name is read; symlink `CLAUDE.md` → `AGENTS.md` when another harness needs the other name.
2. `.atlas/settings.json`: repo-wide settings overrides.
3. `.atlas/mcp.json`: MCP servers for this repo; no secrets in it.
4. `.atlas/services.yaml`: every dev server and API the agent should run and expose. A good file gives one-press previews: each app starts with one press of play or one `service_start({ name })`, and previews work first time. Follow "Writing a good services.yaml" in `references/services.md`.
5. `.agents/skills/`, `.agents/agents/`: repo skills and agent types, the same directories other harnesses read. `.atlas/` holds only Atlas's own files (settings, MCP, services, plugins, worktree).
6. `.atlas/plugins/`: hooks, tools and prompt fragments, as TypeScript.
7. `.atlas/worktree.yaml`: gitignored files (`.env.keys`, local env files, caches) to copy or link into every worktree Atlas creates or adopts; a fresh worktree has none of them otherwise. Atlas creates worktrees under `.atlas/worktrees` and writes its own `.gitignore` there. See `references/worktrees.md`.

## Every file Atlas reads

| File | Scope | Page |
| --- | --- | --- |
| `<atlas-home>/settings.json`, `.atlas/settings.json` | user, project | `references/config.md` |
| `<atlas-home>/mcp.json`, `.atlas/mcp.json`, `.mcp.json` | user, project | `references/config.md` |
| Personal instructions in Atlas Cloud (Settings → Instructions), `AGENTS.md` from the repo root down to the project directory and nested ones | user, project | `references/config.md` |
| `.agents/skills`, `.agents/agents` in the repo; Atlas Cloud user and project skills | user, project | `references/config.md` |
| `.atlas/services.yaml` | project | `references/services.md` |
| `<atlas-home>/plugins/`, `.atlas/plugins/` | user, project | `references/plugins.md` |
| `.atlas/worktrees/`, `.atlas/worktree.yaml` | project | `references/worktrees.md` |
| Cloud sign-in, sandbox settings, backup | user | `references/cloud.md` |

## Pages

Read the page for the task; do not load them all.

| Page | Covers |
| --- | --- |
| `references/config.md` | Settings, instruction files, skills, agent types, MCP, verifying a change |
| `references/services.md` | Writing a good `services.yaml`, `services.yaml` fields, `needs`, `setup`, portals, env references, stale services, `service_start`, URLs, framework host allow-listing, crash loops |
| `references/cloud.md` | Placement, Vercel sandbox setup, `/container`, sign-in and backup, parking, cloud logs |
| `references/cloud-config.md` | `cloud_config` tool: project and personal settings, secrets, MCP servers, file mounts, skills |
| `references/plugins.md` | Writing and installing plugins |
| `references/worktrees.md` | `enter_worktree`, `exit_worktree`, `worktree_list`, `.atlas/worktree.yaml` |

## Sandbox image and toolchains

There is no per-repo container config file. Local Docker runs the built-in Atlas image and a cloud
sandbox runs the image released for its runtime; nothing in the repo chooses an image, Dockerfile,
setup script or mounts. The image picks toolchain versions itself from the repository:
`mise.toml` / `.mise.toml`, `.tool-versions`, `.nvmrc`, `.node-version`, `.bun-version`, and
`packageManager` in `package.json`; `yarn` and `pnpm` come through corepack. A normal repository
needs no setup script — write one in the Atlas Cloud project settings only for what the toolchains
cannot cover (system packages, generated files, a database seeded at boot). Project secrets carry
environment variables into the sandbox, and project file mounts carry files that are not in the
repository.

## Ground rules

- Do not dump `auth.json`, `secrets.json` or credential values; inspect key names only.
- Slash commands (`/settings`, `/mcp`, `/skills`, `/container`) are typed by the operator, not run in `bash`.
- Make the smallest edit, validate it, then say which file changed and how it activates.
