# Atlas Cloud configuration

Use the `cloud_config` tool to read and change Atlas Cloud configuration for the operator.
Use it only when the operator asks for a change.

## Kinds and scopes

| Kind | Holds | Scopes |
| --- | --- | --- |
| `setting` | Atlas settings | project, personal |
| `secret` | Named secret values | project, personal |
| `mcp` | MCP server definitions | project, personal |
| `file` | Files written into each sandbox | project only |
| `skill` | Skill files | project, personal |

- Project scope applies to every sandbox of the project. Personal scope applies to the signed-in user.
- When both scopes set the same name, the project value wins.
- `projectId` defaults to the project of the current session.
- Actions: `list`, `read`, `set`, `remove`.
- `list` never shows secret or file values. `read` shows them. Do not repeat a value to the operator unless asked.

## Limits

- A cloud sandbox can neither read nor change personal scope. Tell the operator to use a signed-in terminal or the web.
- `setting` covers Atlas setting keys only; environment variables are `secret`s.
- Without a sign-in, the tool answers "Not signed in to Atlas Cloud".

## File mounts

- `path` is relative to the repository, or starts with `~/` for the home folder.
- Paths inside `.git` are refused.
- `contents` is text, 64 KiB at most. `mode` is an octal string such as `"0600"` (the default) or `"644"`.
- Atlas rewrites every file on each sandbox start. Edits made to a mounted file in a session are lost on the next start.
- For a repository path, Atlas checks git first:
  - ignored file: written.
  - not ignored: written and added to `.git/info/exclude`, with a notice.
  - tracked file: skipped, with a notice.
- Home paths skip the git checks.

## Recipes

- dotenvx Armor: set a `file` at `~/.config/dotenvx/.env` with the key lines.
- CA file: set a `file` at `~/certs/ca.pem` with the PEM text, then set the project `secret` `NODE_EXTRA_CA_CERTS` to its absolute path, such as `/home/<user>/certs/ca.pem`. Run `echo $HOME` in the sandbox to get the home folder.
- Local env file: set a `file` at `apps/api/.env.personal` with the variables the app needs.

## Skills

- `path` is `<skill>/<file>`; a one-segment path names the skill itself.
- `list` without a path lists the scope's skills; `list` with path `<skill>` shows its files.
- `read` and `set` need a two-segment path. `remove` with `<skill>` deletes the whole skill; with `<skill>/<file>` deletes one file.
- `contents` is utf8 text only; binary files are refused (manage those on the web settings page).
- `set` overwrites without tracking revisions: a "changed since baseRevision" conflict means someone else wrote it; read the file again and retry.
- In a cloud sandbox, personal skills land at `<atlas home>/skills` and project skills at `<atlas home>/project-skills`. At runtime repo skills win over project, project over personal (global), global over built-in.
- Sandboxes overwrite these on-disk copies from Atlas Cloud at the next pod start — edit skills through the tool, never by writing the files. Edits apply to running sessions at the next turn.
- Recipe — override a global skill for one project: `read` it from personal scope, then `set` the edited copy in project scope.

## When a change takes effect

- In a cloud sandbox: settings and secrets apply before the next turn.
- In a cloud sandbox: files and MCP servers apply on the next sandbox start.
