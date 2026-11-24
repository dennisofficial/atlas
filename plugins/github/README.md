# @dltech/atlas-plugin-github

Subscribe a thread to a GitHub pull request or workflow run, so the events reach the thread as notices. The plugin holds the two providers, the target parsers, the event catalog, the presentation and the `subscription` tool.

## Owns

- The providers `github.pull-request` and `github.workflow-run`, and the labels that the `subscription` tool shows for them.
- `parseTargetInput` and `parseRunTargetInput`: the pull request and the run references that a caller can pass.
- The event catalog of each provider, and the rule that maps a pull request event kind to a filter group.
- The `subscription` tool: `subscribe`, `unsubscribe` and `list`.
- The `subscriptions` view fold for GitHub rows.
- The policy hook that denies a `bash` call which watches or polls CI.
- The control hook that records the tracking targets of a pushed branch.
- `githubIdentityLookup`: the git author name and email for a GitHub token.

## Does not own

- Subscription storage and delivery. The subscription plane in `packages/control` owns them, and the `PodSubscriptions` port carries them.
- GitHub webhook intake and the pull request state. `apps/api` owns both.
- The `bash` tool. `apps/api` owns it (`apps/api/src/agent/agent-tools/bash.ts`).
- The card that shows a subscription. Each client draws it from the subscription view.

## Entry points

| Import                                | Use it for                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `@dltech/atlas-plugin-github/core`    | The providers, `parseTargetInput`, `parseRunTargetInput`, the event catalog, the presenters and the `subscriptions` fold. |
| `@dltech/atlas-plugin-github/pod`     | `githubPod`: the `subscription` tool, the CI hook, the prompt fragment and `githubIdentityLookup`.                        |
| `@dltech/atlas-plugin-github/control` | `githubControl` and `trackingTargetHook`: the hook that records the tracking targets.                                     |
| `@dltech/atlas-plugin-github/client`  | `githubClient`: the client hook for the `subscription-*` events.                                                          |

## Capabilities

### Read a target

- `GITHUB_PROVIDER` and `GITHUB_RUN_PROVIDER`: the two provider names.
- `parseTargetInput(raw)`: reads `#123`, `owner/repo#123`, a pull request URL, or a blank string for the pull request of the project directory.
- `parseRunTargetInput(raw)`: reads `#<run id>`, `owner/repo#<run id>`, a run URL, `<workflow>@<branch>`, or a blank string for the newest run of this push. A bare workflow name or file, such as `deploy.yml`, selects that workflow on the branch of the checkout.
- A blank run target with no run for the pushed commit is refused and points at
  `<workflow>@<branch>`.
- `pullRequestStateOf({ target, pull })` and `runStateOf({ target, run, failedJobs })`: read a
  target's current phase from a GitHub response, so a subscription made on an already finished
  target gets its final notice at once. `repoFullNameOf(repo)` drops the `github.com/` prefix.
- `pullRequestSnapshotOf(input)` and `runSnapshotOf(jobs)`: the facts a subscribe result shows
  about an open target, and the notice that comes next. `reviewDecisionOf(reviews)` reads the
  latest review of each reviewer.

### Describe a subscription

- `eventCatalogOf(provider)`: the event filters that a provider accepts, each with its summary.
  `github.pull-request` takes `comments`, `ci`, `mergeability` and `state`; `state` always arrives.
  `github.workflow-run` takes no filter.
- `githubPresenters`: the title, icon and tone of a subscription row for each provider.
- `foldSubscriptions(state, event)` and `subscriptionsOfEvents(events)`: the `subscriptions` view
  state of a thread, for every provider in its events.

### Call the subscription tool

`subscription` takes one `action`:

| Action        | Needs            | What it does                                                                |
| ------------- | ---------------- | --------------------------------------------------------------------------- |
| `subscribe`   | `provider`       | Subscribe the thread. Also takes `target`, `events` and `expiresInMinutes`. |
| `unsubscribe` | `subscriptionId` | End one subscription.                                                       |
| `list`        | nothing          | Show each subscription and the providers that a thread can subscribe to.    |

`target` is a pull request reference or a workflow run reference. Leave it out when the provider
works the target out from the session. A blank `github.workflow-run` target names the newest run
of the pushed commit. A target that already reached its end (a merged or closed pull request, a
finished run) gets its final notice at once, the subscription ends, and the reply names that state. `events`
keeps only the named filters. `expiresInMinutes` ends the subscription later.

### Refuse a CI watch

- `ciWatchIntent({ command })`: says whether a shell command watches or polls a pull request or a run, and which one.

## Plugin contributions

### Pod tier (`githubPod`)

| Kind       | Name                                 | What it adds                                                                                                          |
| ---------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Tool       | `subscription`                       | Subscribes the thread to a provider, unsubscribes one, or lists the subscriptions.                                    |
| Hook       | `github-block-ci-watch` (beforeTool) | Denies a `bash` command that watches or polls CI. The refusal names the subscription that makes the wait unnecessary. |
| Prompt     | `github.ci-feed`                     | Tells the model how a subscription delivers events, and that a one-shot read stays allowed.                           |
| Child deny | `subscription`                       | A sub-agent cannot subscribe.                                                                                         |

### Core tier (`githubCoreSlots`)

`githubCoreSlots` declares no events, no views and no commands. The core functions above are exported for a caller that composes them itself.

### Control tier (`githubControl`)

| Kind | Name                      | What it adds                                                                                 |
| ---- | ------------------------- | -------------------------------------------------------------------------------------------- |
| Hook | `github-tracking-targets` | Applies to `branches-observed` and records each worked head as a tracking target for 7 days. |

### Client tier (`githubClient`)

| Kind | Name                   | What it adds                                             |
| ---- | ---------------------- | -------------------------------------------------------- |
| Hook | `github-subscriptions` | Applies to each event whose type starts `subscription-`. |

## Usage

```ts
import { githubControl } from '@dltech/atlas-plugin-github/control'
import { githubCoreSlots } from '@dltech/atlas-plugin-github/core'
import { githubPod } from '@dltech/atlas-plugin-github/pod'
import { definePlugin } from '@dltech/atlas-plugin-sdk'

definePlugin({
  name: 'github',
  ...githubCoreSlots,
  pod: githubPod,
  control: githubControl,
  client: { hooks: [] },
  transport: 'stream',
})
```

## Rules

- Nothing about a pull request reaches a thread until the thread subscribes. The notice wakes the thread; the thread does not poll.
- Do not read CI in a loop. Write `gh pr checks` once without `--watch`, or end the turn and wait for the notice.
- Import `@dltech/atlas-plugin-github/pod` in the pod only. The hook reads the checkout and runs commands.
- A pull request target is `{ repo, number }`. A workflow run target is `{ kind: 'run', repo, runId }` or `{ kind: 'selector', repo, workflow, branch }`. The `repo` field holds `github.com/<owner>/<repo>` in lowercase. `targetOf` and `runTargetOf` lowercase the field.

## See also

- [The v2 package map](../../docs/decisions/0019-v2-package-map.md)
- [`packages/plugin-sdk/src/slots.ts`](../../packages/plugin-sdk/src/slots.ts)
