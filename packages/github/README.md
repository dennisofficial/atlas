# @dltech/atlas-github

The GitHub domain of Atlas: the App client and installation tokens, the webhook intake and its
delivery pipeline, the pull-request state store, the polling sweeper, and the subscriptions that
track a repository or a pull request. `apps/api` drives it through thin Nest adapters, and
`apps/trigger` runs its sweeps.

## Owns

- The GitHub App client, installation tokens, and the installation sync from the GitHub API.
- Webhook signature checks, event filtering, and the delivery pipeline: store, outbox, mailbox,
  fan-out, and the effects a thread sees.
- The pull-request state rows, their reconcile and mergeability decisions, and the checks tally
  that feeds them.
- Repository tracking: hook lifecycle, the refresh queue, the poll sweeper, and the request budget
  that keeps under GitHub's rate limit.
- Subscriptions of a thread to a repository or a pull request, and the frames that reach a client.
- Check annotations, review-comment excerpts, and branch protection reads.

## Does not own

- The HTTP routes and their guards. `apps/api` owns the controllers, the tRPC routers and the
  status mapping from `GithubHttpError`.
- The v1 sandbox wake and the v1 thread signals. They arrive through the `GithubLegacyEffects`
  port, which `apps/api` supplies and `apps/trigger` leaves out.
- The database schema. `@dltech/atlas-db` owns the rows; this package reads and writes them.
- Configuration storage. The caller builds a `GithubConfig` and passes the ports it needs.

## Entry points

| Import                         | Use it for                                                  |
| ------------------------------ | ----------------------------------------------------------- |
| `@dltech/atlas-github`         | Every service, policy, store, port and error of the domain. |
| `@dltech/atlas-github/testing` | Seeds, fakes and fixtures for a spec.                       |

## Capabilities

### The App and its tokens

- `GithubAppClient`, built from a `GithubConfig`, signs an App JWT and mints installation tokens.
- `GithubAppInstallationsService` and `GithubAppSyncService` keep the installation rows current.
- `GithubInstallationTokens` caches a token per installation until shortly before it expires.

### Webhooks and delivery

- `verifyGithubSignature` and `wantsPrEvent` decide whether a delivery is authentic and
  interesting.
- `GithubDeliveryService` turns a webhook payload into store writes and queued outbox rows.
- `GithubWebhookInboxService` stores every authentic delivery, keyed by the delivery id, before
  any processing, and retries the ones that never processed.
- `GithubPrOutboxDispatcher` claims rows, runs them, parks a failure for a retry, and dead-letters
  one that keeps failing. Pass `legacy` to run the v1 `wake` and `thread-signal` kinds; without it
  those rows stay unclaimed.
- `GithubPrEventMailboxService` keeps one delivery per thread and event, with a lease and an ack.
- `GithubPrFanoutService` pushes a state change or an event to the client frames of a stream.

### Pull-request state

- `GithubPrStore` writes a folded pull-request row and appends its event.
- `GithubPrReconcile`, `GithubPrMergeabilityRefresh` and `applyObservedPull` decide what the row
  says next, and `foldStateOfRow` folds a stored row into the fold state.
- `readCommitChecks` and `commitChecksTally` read and tally check runs and statuses, and
  `failedChecksOfRows` gives the failed ones.

### Tracking, polling and subscriptions

- `refreshGithubQueue` walks the due tracking targets under `GithubRequestCoordinator`.
- `GithubPollSweeperService` seeds targets, polls them, and expires the ones nobody watches.
- `GithubHookLifecycleService` and `GithubHookRetirement` create, repair and retire a repository
  hook.
- `GithubSubscriptionsService` subscribes a thread, catches up a branch, and links a sandbox.
- `prStreamFrames` turns a fan-out attachment into the frames of a PR stream, and
  `GithubPrEventMailboxService` gives its `replayUndelivered`, `replayForThread` and `acknowledge`
  steps.
- `buildGithubSweeps` builds the poll, hook and webhook-reconcile sweeps over a config, a cipher and
  a redis port. Omit `legacy`/`activityOf` and the sweeps run without v1; `dispose` tears the
  fan-out down.

### Connect a user account and read repositories

- `GithubService` runs the OAuth device flow, stores the encrypted user token and reads the
  connection.
- `GithubRepoReads` lists repositories, branches and trees, and reads a file.

### Ports

- `GithubConfig`: the App id, the private key, the App slug, the client id and the public API URL.
- `GithubSecretCipher`, `GithubRedis`, `GithubDrain`: small structural ports.
- `githubRedisOf({ url })`: a `GithubRedis` over one lazy ioredis connection, with `close()` for a
  worker that builds its graph per run. `@dltech/atlas-pods`' `SecretCipher` is a
  `GithubSecretCipher` already.
- `GithubLegacyEffects` and the `activityOf` callback: the v1 seams. Omit them and the package runs
  without v1.
- `GithubHttpError`: a failure with a status, which the caller maps to its own HTTP error.

### Logging

- `githubLogOf(context)` returns the logger for one context. Its default writes to the console;
  `setGithubLogSink` replaces it, and `apps/api` points it at the Nest `Logger`.

## Usage

```ts
import { GithubAppClient, GithubConfig, setGithubLogSink } from '@dltech/atlas-github'

setGithubLogSink((context) => ({
  log: (line) => console.log(`${context}: ${line}`),
  warn: (line) => console.warn(`${context}: ${line}`),
  error: (line) => console.error(`${context}: ${line}`),
}))
const config = new GithubConfig({ appId, appPrivateKey, clientId })
const client = new GithubAppClient(config)
```

## Rules

- Build every service with `new`. There are no decorators and no container in this package.
- Pass `legacy` only where v1 effects are wanted. A dispatcher without it leaves the legacy outbox
  kinds for the v1 sweep.
- Treat `GithubHttpError` as the only error a caller must map. Every other failure is a bug.
- Read the package through its entry points. Never import a deep path.

## See also

- `apps/api/src/api/cloud/github` for the Nest adapters, controllers and routers.
- `packages/core/src/github` for the pure reducers this package folds with.
