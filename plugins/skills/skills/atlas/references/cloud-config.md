# Atlas Cloud configuration

Use the `cloud_config` tool for Atlas Cloud settings, secret values, file mounts and access grants.
Use it only when the operator asks for a change.

## Scopes and kinds

| Kind | Holds | Scopes |
| --- | --- | --- |
| `setting` | Atlas setting keys | project, personal |
| `secret` | Environment variables | project, personal |
| `file` | Files written into the sandbox | project, personal |
| `grant` | A named group of secrets and files, plus an instruction | project, personal |

- `scope` is `project` (the project of this session) or `personal` (every project the operator runs).
- A project secret or file with the same name or path wins over a personal one.
- A session without a project has personal scope only; a project action fails.
- Actions: `list`, `read`, `set`, `remove`.

## Access grants

- Every secret and every file belongs to a grant.
- Create the grant first: `kind: grant, action: set, name: PlanetScale, instruction: "..."`.
- The instruction says what the access is for. The agent reads it in its access notice each turn.
- A new `secret` or `file` must name `grant`; without one the call is refused.
- Setting an existing member again without `grant` keeps it in its grant. With `grant` it moves, and an earlier grant left with no members and no instruction is deleted.
- `remove` on a grant deletes the grant with its secrets and files.
- `set` on an existing grant name updates it; `newName` renames it.

## Values

- `setting` covers Atlas setting keys only (`model.fast`); environment variables are `secret`s.
- A secret is named like `FOO_BAR` and exported to the agent shells. `list` shows each name with its grant.
- Secret and file values are write-only: `read` is refused, `set` replaces.
- `kind: grant, action: read` shows one grant with its members and instruction.

## Files

- A project path is relative to the repository. Paths inside `.git` are refused.
- A personal path starts with `~/` (the sandbox home) or `@/` (the Atlas home). A repo-relative personal path is refused.
- `contents` is text, 64 KiB at most. `mode` is an octal string such as `"0600"` (the default) or `"644"`.
- Atlas writes every file on each sandbox start, so an edit made in a session is lost on the next start.
- For a project repository path, Atlas checks git first: an ignored file is written; an untracked one is written and added to `.git/info/exclude` with a notice; a tracked one is skipped with a notice. Home paths skip the git checks.

## Worked example

Give the agent PlanetScale access:

1. `kind: grant, action: set, name: PlanetScale, instruction: "Use these for database work with the pscale CLI."`
2. `kind: secret, action: set, name: PLANETSCALE_SERVICE_TOKEN, value: ..., grant: PlanetScale`
3. `kind: secret, action: set, name: PLANETSCALE_SERVICE_TOKEN_ID, value: ..., grant: PlanetScale`
4. `kind: grant, action: read, name: PlanetScale` to check the members.

## When a change takes effect

- Settings and secrets: the next turn, in every sandbox of the scope.
- Files: the next sandbox start.
- Grants and their instructions: the next turn, through the access notice.
