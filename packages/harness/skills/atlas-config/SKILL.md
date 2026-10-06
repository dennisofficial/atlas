---
name: atlas-config
description: Configure and troubleshoot Atlas settings, settings.json, ATLAS_HOME, instruction files (ATLAS.md, AGENTS.md, CLAUDE.md), skills, agent types, and MCP servers (mcp.json, .mcp.json). Use when asked how Atlas is configured, to change its configuration, or why it is not picking up a file.
---

# Atlas configuration

Use this guide without an Atlas source checkout. Establish the session's current project directory
and Atlas home before inspecting files. For Cloud execution, transfer, and sign-in, load `atlas-cloud`.
These instructions describe configuration mechanisms, not the live values in this session.

## Locate the configuration

Atlas home is non-empty `ATLAS_HOME`, otherwise `~/.atlas`. A project is the session's working
directory, including an entered worktree. A shell's environment may differ from Atlas's launch
environment. Use current workspace reminders; do not assume the repository's main checkout.

| Kind         | User                                                          | Project                                                          |
| ------------ | ------------------------------------------------------------- | ---------------------------------------------------------------- |
| Settings     | `<atlas-home>/settings.json`                                  | `<project>/.atlas/settings.json`                                 |
| MCP          | `<atlas-home>/mcp.json`                                       | `<project>/.atlas/mcp.json`, `<project>/.mcp.json`               |
| Instructions | `<atlas-home>/ATLAS.md`                                       | `AGENTS.md`, `CLAUDE.md`, `ATLAS.md`, their `.local.md` siblings |
| Skills       | `<atlas-home>/skills`, `~/.agents/skills`, `~/.claude/skills` | `.atlas/skills`, `.agents/skills`, `.claude/skills`              |
| Agent types  | Corresponding `agents` roots                                  | Corresponding `agents` roots                                     |

Cloud compatibility roots for skills use `/atlas/home/.agents/skills` and `/atlas/home/.claude/skills`.
Agent compatibility roots still use the sandbox's ordinary home. Prefer `skill_install` for skills.
Cloud user settings follow the attached terminal; sandbox edits do not sync back. Change them on the terminal.

Read only relevant non-secret configuration. If a file can contain tokens or headers, inspect key
names or masked values. Do not dump `auth.json`, `secrets.json`, vault keys, or credential values.
Atlas has no `atlas config` CLI or effective-settings inspection tool. The slash commands below
are typed by the operator in Atlas, not run in `bash`; ask for relevant non-secret output if needed.

## Settings

Settings files are flat JSON objects keyed by dotted id, for example `{"context.reload": true}`.

- Precedence: built-in default < user file < project file < the setting's declared environment
  variable. Environment overrides come from Atlas's launch environment.
- Unknown ids and invalid values are rejected; the next valid lower layer applies. Keys starting
  with `$` are dropped. Secret settings belong in the app's credential controls, not settings JSON.
- Invalid JSON is reported. At startup it supplies no overrides; a watcher can retain the prior
  valid document after a broken edit. Repair the file rather than assuming the value reset.
- `/settings` shows labels, descriptions, current values, and `layer · origin` provenance.
  It does not show file ids or raw choice values. Use the verified ids below for file edits;
  for other settings, prefer the UI and inspect its resulting non-secret configuration.
- Settings UI changes write the user file. A project or environment override can still win.
  Files are watched, but activation depends on the consumer: some configuration is captured at
  launch. Restart when a launch-only setting changes.
- Default model preferences differ from the model saved on an existing conversation. `/model`
  changes that conversation. Child model settings affect new spawns, not existing children.

## Instruction files

User-wide instructions come from `<atlas-home>/ATLAS.md`. Project discovery walks from the repository
root to the project directory. With the default filename selection, each directory contributes
`AGENTS.md`, `CLAUDE.md`, `ATLAS.md`, then `AGENTS.local.md`, `CLAUDE.local.md`, `ATLAS.local.md`.
More specific instructions take precedence; nested directories touched by tools can add instructions.

`context.userInstructions` and `context.projectInstructions` control loading. `context.filenames`
selects `both`, `agents`, `claude`, or `none`; `none` still permits Atlas-named files.
`context.reload` defaults on and re-reads root instructions each turn. With reload off, already-loaded
instructions stay cached. The reader has a 40,000-character budget and skips whole overflowing files.

## Skills

Write `<skill-root>/<name>/SKILL.md` or a flat `<skill-root>/<name>.md`. Prefer `skill_install` for
installation. Project definitions override user definitions, which override built-ins by name;
within a layer Atlas roots precede `.agents`, then `.claude`. `/skills` reloads and reports changes.

Put `name` and `description` in YAML frontmatter, followed by the Markdown procedure.

Use lowercase names with digits and hyphens, matching the folder, at most 64 characters. Descriptions
have a 1,024-character limit and teach the model when to load the body. `user-invocable` defaults true;
`disable-model-invocation` defaults false. The prompt lists descriptions; the `skill` tool loads bodies
on demand. Built-ins have no installed directory, so they must work without local supporting files.
To substitute invocation arguments, write a dollar sign followed by `ARGUMENTS` or a digit `1`–`9`.
Substitution applies throughout the body, including fenced examples. Other accepted frontmatter is
not proof of tool restrictions or model switching; verify behavior before promising enforcement.

## Agent types

Add flat `<agents-root>/<name>.md` files; subdirectories are not scanned. Frontmatter uses `name`,
required `description`, and optionally `tools`, `disallowed-tools`, `model`, `max-effect`. The body
is the agent prompt. Names match `^[a-z][a-z0-9-]*$`; `teammate` is reserved. An unusable model or
invalid definition refuses the type. Project overrides user overrides built-in. Restart after edits;
`/agents types` reports loaded, refused, and shadowed definitions.

## MCP servers

Native user and project `mcp.json` files accept a server-name map, optionally wrapped in `mcpServers`:

HTTP example: `{"docs": {"transport": {"kind": "http", "url": "https://example.com/mcp"}}}`.
Stdio example: `{"local": {"transport": {"kind": "stdio", "command": "my-mcp-server", "args": [], "env": {}}}}`.

Entries support `transport` and optional `disabled`; a disabled stub may omit transport. HTTP accepts
`headers`; stdio accepts `args` and `env`. Names contain letters, digits, `_`, or `-`.
Project native entries override user native entries. Project-root `.mcp.json` accepts Claude-compatible
`command`/`args`/`env` or `type`/`url`/`headers` entries, only for names no valid native file defines.
It is a compatibility fallback, not an override of native configuration.

Values are literal: `${VAR}` is not expanded. Stdio inherits only `PATH`, `HOME`, and its explicit
`env`. Keep credentials out of committed files. `/mcp signin <name>` handles HTTP OAuth.
Prefer `mcp-edit` to modify one named server in the chosen layer; inspect its current entry first.
Enable/disable replace the entry, so supply its transport to preserve it. Restart after config edits;
`/mcp` reports each server's status, tool count, and layer. Available tools use `mcp__<server>__<tool>`.

## Change and verify

1. Choose user scope for personal configuration or project scope for repository-shared configuration.
2. Inspect the existing file without exposing secrets; preserve unrelated keys in the smallest edit.
3. Validate JSON without printing it (`jq empty <file>`). Use verified file ids/values;
   use `/settings` itself when the installed version's file schema is not known.
4. Report the changed path and activation: settings according to their consumer, instructions next
   turn with reload on, `/skills` for skills, restart for MCP and agent types.
5. Verify through the matching operator command or runtime evidence. Stored overrides alone do not
   prove the running session's state. For ignored changes, check home, project directory, shadowing,
   invalid entries, and activation before retrying.
