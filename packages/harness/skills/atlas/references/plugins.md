# Atlas plugins

A plugin is a TypeScript module that Atlas imports at session start from a plugins directory. It can add hooks (code that runs around turns, tool calls, and chunks), tools, prompt fragments, and a few UI/integration contributions. Plugins are local files: there is no plugin registry, no marketplace, and no "install from GitHub" command for them. "Installing" a plugin means putting its `.ts` file or directory into one of the two directories below. Plugins run with full user privileges, so read any plugin before you install it.

## Where plugins live

| Scope | Directory |
| --- | --- |
| User (all projects) | `$ATLAS_HOME/plugins/` (default `~/.atlas/plugins/`) |
| Project | `<repo>/.atlas/plugins/` |

Both directories are read at session start. Changes need a new session (restart Atlas or open a fresh one); nothing is hot-reloaded.

User plugins always load. Project plugins load only when the repository is trusted: its key must be listed in the
user setting "Trusted repositories" (`plugins.trustedRepos`, a comma-separated list, case-insensitive). The key is
the normalized `origin` remote, `github.com/<owner>/<repo>`, so trust follows the repo into Cloud sandboxes where the
checkout path differs; a repo with no usable remote is keyed by its absolute path. An untrusted repo with project
plugins shows one warning, `project plugins not loaded: <ids> — add <key> to Trusted repositories …`, and none of
them run. Set it in the TUI settings (General → Plugins) or the Atlas Cloud agent settings, then start a new
session. A repository cannot trust itself: the setting is ignored in `.atlas/settings.json`.

- A plugin is either a bare `*.ts` / `*.tsx` file, or a subdirectory containing `index.ts` / `index.tsx`. Files starting with `.` and `*.d.ts` are ignored, as are dot-directories.
- A subdirectory with no `index.ts(x)` is reported as unreadable, not skipped silently.
- Each plugin has a string `id`. If a user plugin and a project plugin share an id, the project one wins. Two files in the same directory with the same id: the first by filename order loads, the second is refused (`duplicate-id`).
- Built-in plugins (`github`, `foreign-checkout`) cannot be replaced. A repo plugin with one of those ids is layered over it, and its port bindings override the built-in's.

## How a plugin gets the API

A plugin imports from the bare specifier `'atlas'`:

```ts
import { definePlugin, EHookPhase, EStage } from 'atlas'
```

`'atlas'` is not an npm package. Atlas registers it at runtime as a virtual module, so any plugin file loaded by Atlas can import it, with no install and no `package.json`. Because it is the host's own module object, classes and enums you import (for example `ToolDefinition`, `EStage`) are the same ones Atlas uses.

Consequences:

- Plugins are executed by Bun. Write TypeScript/ESM; no build step.
- Do not put a `node_modules` containing an `atlas` package under the plugins directory: it shadows the virtual module and the plugin is refused with `not-defined-by-atlas`.
- Types: the typed declaration for `'atlas'` is a generated `atlas.d.ts` that only an Atlas source checkout can produce; it is not shipped with the binary or published. Without it, editors and `tsc` will not know the module. Do not invent a package to install; either work untyped (JS-style, runtime is unaffected) or add a local `declare module 'atlas'` stub in the plugin directory (a `.d.ts` file there is ignored by the loader).
- Other bare imports (for example `zod`, needed to define a tool's input schema) are resolved by Bun from the plugin file's own directory upward, like normal Node resolution. They are not provided by Atlas. A project plugin can use packages installed in the project's `node_modules`; a user-level plugin needs its own install next to it (and see the shadowing warning above).

## Shape of a plugin

The default export must be the result of `definePlugin({ id, register })`. A plain object is refused. `register(host)` may be async and returns a contribution object; every field is optional.

`host` provides: `id`, `origin`, `projectDirectory`, `atlasHome`, `log`, `workspace`, `clock`, `ids`.

Contribution fields:

| Field | What |
| --- | --- |
| `hooks` | Array of `{ phase, name, order: { stage, nudge }, run }` |
| `tools` | Instances of a class extending `ToolDefinition` (`name`, `description`, `effect`, `inputSchema`, `invoke`) |
| `promptFragments` | Instances of a class extending `PromptFragment` (`id`, `text(ctx)`, optional `applies(ctx)`) |
| `ports` | Advanced: `{ token, use }` bindings replacing an internal port |
| `projections`, `surfaces`, `intakeSources`, `subscriptionProviders` | Advanced: UI/event-feed/subscription contributions; surfaces are only rendered by the terminal UI |
| `dispose` | Cleanup called when the session closes |

Hook phases (`EHookPhase`): `BeforeTurn`, `BeforeStep`, `BeforeRequest`, `BeforeTool`, `AfterTool`, `AfterShell`, `OnChunk`, `AfterTurn`, `OnThreadOpen`. Stages (`EStage`) run in order `Guard`, `Policy`, `Observe`; `nudge` is a number that orders hooks within a stage. `BeforeTool` returns `{ decision: EBeforeToolDecision.Allow, input }` or `{ decision: EBeforeToolDecision.Deny, reason }`. Turn-style hooks return `{ additionalContext?, drafts? }` (`additionalContext` is injected into the model's context). Tool effects (`EToolEffect`): `Read`, `Write`, `Destructive`. A hook is namespaced as `<scope>:<id>:<name>` in logs.

`register` has a 5 second budget; throwing, timing out, or returning nothing refuses the plugin. Hooks and tools behave the same in the terminal UI and in `atlas serve`/cloud sessions.

## Minimal working example

Save as `<repo>/.atlas/plugins/guard.ts`:

```ts
import {
  definePlugin,
  EBeforeToolDecision,
  EHookPhase,
  EStage,
  EToolEffect,
  PromptFragment,
} from 'atlas'

class RepoRules extends PromptFragment {
  readonly id = 'repo-rules'
  text() {
    return 'This repo uses bun. Never run npm or yarn.'
  }
}

export default definePlugin({
  id: 'repo-guard',
  register: (host) => ({
    promptFragments: [new RepoRules()],
    hooks: [
      {
        phase: EHookPhase.BeforeTool,
        name: 'no-destructive',
        order: { stage: EStage.Guard, nudge: 0 },
        run: async ({ call }) =>
          call.effect === EToolEffect.Destructive
            ? { decision: EBeforeToolDecision.Deny, reason: `${host.id}: destructive tools are off in this repo` }
            : { decision: EBeforeToolDecision.Allow, input: call.input },
      },
    ],
  }),
})
```

Start a new session and ask the agent to do something destructive; the tool call is denied with that reason.

## When a plugin does not load

A refused plugin does not stop Atlas or other plugins. Atlas shows a warning notice at startup: `plugin refused: <id> — <reason>` (id is `?` if it could not be read). Refusal reasons:

- `unreadable`: import failed (syntax error, missing dependency, directory with no `index.ts`). Detail carries the error message.
- `no-default-export`, `not-an-object`, `id-not-a-string`, `id-empty`, `register-not-a-function`: the default export is not a plugin object.
- `not-defined-by-atlas`: the export was not produced by `definePlugin` from `'atlas'`, or a local `node_modules` shadowed `'atlas'`.
- `duplicate-id`: another file in the same directory already claimed that id.
- Contribution errors (`hook-phase-unknown`, `hook-order-invalid`, `hook-name-missing`, `hook-run-missing`, `hooks-not-an-array`, `projection-*`, `intake-source*`, `subscription-provider*`, `contribution-not-an-object`): `register` returned something malformed. The detail lists valid phases and stages.
- `threw`, `overran`, `returned-nothing`: `register` threw, exceeded 5s, or returned `undefined` (it must return an object, even `{}`).

Diagnose by reading the notice, fixing the named file, and starting a fresh session. If no notice appears at all, check the file is directly in the plugins directory with a `.ts`/`.tsx` extension and that the correct `$ATLAS_HOME` is in effect.

## Safety

Plugins are not sandboxed: they run in the Atlas process with your filesystem, network, and credentials access. That is why project plugins wait for trust. Review a repository's `.atlas/plugins/` before adding it to Trusted repositories, and prefer hooks in the `Guard` stage for policy rather than relying on prompt text.
