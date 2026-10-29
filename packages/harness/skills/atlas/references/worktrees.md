# Atlas worktrees

Atlas isolates a workstream in a git worktree through three tools: `enter_worktree` creates one (or adopts an existing one) and moves the session into it, `exit_worktree` leaves it, and `worktree_list` shows what exists. While a session is in a worktree, that worktree is the project directory: tool paths resolve against it, `bash` starts there, and instruction files, project settings and project skills are read from it. The repository's main checkout stays where it was and is left alone.

## When Atlas uses one

Only when the user asks, the project instructions say work happens in a worktree, or the agent contract calls for one. "Fix this" or "start a branch" is not a request for a worktree. Working a pull request (review, feedback, watching) is: Atlas tracks the pull request of the checkout the session stands in, so a review run from the main checkout goes untracked.

## Creating: `enter_worktree` with `name`

```
enter_worktree { name: "fix-login" }
```

- Creates `<repo>/.atlas/worktrees/fix-login` on a new branch `fix-login`.
- Runs `git fetch origin` first, then cuts the branch from `origin/<default>`. The default is `origin/HEAD`, else `origin/main`, else `origin/master`; with no origin ref it falls back to a local `main`/`master` and cuts from that. If the fetch fails the branch is cut from whatever the ref already pointed at locally, and the reply says so.
- Branch name = worktree name. Names are at most 64 characters; slash-separated segments may hold letters, digits, `.`, `_`, `-` and must start with a letter or digit. `dennis/fix-login` is valid and nests the directory (`.atlas/worktrees/dennis/fix-login`), which is how to follow a `<you>/<slug>` branch convention.
- Fails if the branch or path already exists, or if the session is already in a worktree. Leave first, or switch by passing `path`.
- Not a git repository: it refuses.

## Entering an existing one: `path`

```
enter_worktree { path: "../repo-hotfix" }
```

`name` and `path` are mutually exclusive. The path must be one `git worktree list` shows for this repository. Relative paths resolve against the session directory first, then the repository root. Refused: the main checkout, bare, prunable, or detached-HEAD worktrees. The reply reports the branch, its upstream, uncommitted files, and commits ahead/behind. This is adoption: Atlas did not create it, so `exit_worktree` never removes it, whatever is asked. It also works for worktrees under the Atlas directory that a previous session made. A teammate (peer session) is told to create its own worktree with `git worktree add` per the project's conventions, then adopt it by path.

## Leaving: `exit_worktree`

```
exit_worktree { action: "keep" }                      # leave, keep worktree and branch
exit_worktree { action: "remove" }                    # delete worktree and its branch
exit_worktree { action: "remove", discardChanges: true }
```

- Call it only when the user asks to leave; never as tidying after a task.
- The session returns to the repository's main checkout.
- `remove` only applies to worktrees created by `enter_worktree name`. For adopted worktrees, or one the session was launched inside, it silently downgrades to keep.
- `remove` is refused while the worktree has uncommitted changes, or commits on neither its upstream nor the ref it was cut from. The refusal names what would be lost. Ask the user before setting `discardChanges`, which forces removal. Removal runs `git worktree remove` and then `git branch -D`; if the branch delete fails it is reported and the branch stays.
- Outside any worktree it does nothing and says so.
- A session launched inside a linked worktree counts as being in one: exit moves it to the main checkout and keeps the worktree.

`worktree_list` prints each worktree with its branch, marking the main checkout, the current session, and locked or prunable entries.

## Location and configuration

- Default home: `.atlas/worktrees`, relative to the main checkout's root.
- The setting `worktree.directory` (environment variable `ATLAS_WORKTREE_DIRECTORY`) selects it. It accepts only two values: `.atlas/worktrees` (default) and `.worktrees`; anything else is rejected and the next lower layer applies. Set it in `.atlas/settings.json` (`{"worktree.directory": ".worktrees"}`), the user settings file, or the environment; see the config page for precedence.
- Before creating a worktree, Atlas writes a `.gitignore` containing `*` inside the worktree directory, so the checkouts never appear as untracked files without editing the repository's own ignore rules. Adopting a worktree under that directory does the same.

## Locks and concurrent sessions

Atlas marks its worktrees with `git worktree lock`, with a reason recording the thread and process id. This protects them from `git worktree prune`/removal while a session is live. On entry or reopening a thread: a lock held by a live Atlas process makes this session a guest (warned: commit only your own files, pull before pushing); a lock from a dead Atlas process is cleared and retaken; a lock set outside Atlas is left alone. Exit releases only locks Atlas owns. Sub-agents are denied the worktree tools; they work in the directory their parent was in when they were spawned and share its worktree.

## Recommended repo setup

- Git itself: a worktree needs a git repository with commits. Setting `origin` (and ideally `origin/HEAD`, via `git remote set-head origin -a`) makes the default branch unambiguous.
- Ignoring the directory is optional for the default (Atlas writes its own `.gitignore`); adding `.atlas/worktrees/` to the repo's `.gitignore` is harmless.
- A fresh worktree is a clean checkout: gitignored files (`node_modules`, `.env`, build output, `*.local.md` instruction files) are absent. Document the install step (for example `bun install`) in `AGENTS.md`/`CLAUDE.md` so the agent runs it after entering. Project settings (`.atlas/settings.json`) and project skills are read from the worktree, so they only apply if committed.
- Tell Atlas the branch convention in instructions (e.g. `Branch as <you>/<slug>`), since `name` becomes the branch verbatim.
- Do not write into the main checkout while working in a worktree unless asked; reach it by absolute path only.
