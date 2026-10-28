import { EHookPhase, EStage, LogPort, type HookOrder } from '@dltech/atlas-core'
import type { CloudSession, CloudSessionStore } from '../../cloud/cloud-session'
import { portToken, registeredPortToken, type DependencyContainer } from '../../container/injection'
import type { PrEventFrame } from '../../cloud/pr-event-frame'
import type { AppInstallRecommendation } from '../../cloud/pr-subscription-client'
import { SsePullRequestPort } from '../../cloud/sse-pull-requests'
import {
  AtlasHomeToken,
  ClientVersionToken,
  CloudSessionStoreToken,
  ServeSessionToken,
  WorkspaceRoot,
} from '../../container/tokens'
import { NativePlugin, type PluginContribution } from '../plugin'
import { AppInstallRecommendationSink, MutableAppInstallSink } from './app-install-sink'
import { BlockCiWatchBeforeToolHook } from './ci-watch-hook'
import { CiFeedFragment } from './ci-feed-fragment'
import { createCloudCheckout } from './cloud-checkout'
import { FailoverPullRequestPort } from './failover-pull-requests'
import { GhPullRequestPort } from './gh-pull-requests'
import { RefreshPullRequestAfterShellHook, RefreshPullRequestAfterToolHook } from './hooks'
import { createPullRequestLinks, type PullRequestLinks } from './links'
import { createPollDiffer } from './pr-event-diff'
import { MutablePrEventSink, PrEventFrameSink } from './pr-event-sink'
import { createPullRequestProvider, type PullRequestProvider } from './pull-request-provider'
import { CachedPullRequestPort } from './pull-request-cache-port'
import { createPullRequestService, type PullRequestService } from './pull-request-service'
import { PullRequestPort, type PullRequestReading } from './pure'
import { createSessionFacts } from './session'
import type { PullRequestTarget } from './subscription-target'

import { createCheckoutTracking } from './tracking'
import { GithubUiBridgePort } from './ui-bridge'

const OBSERVE: HookOrder = { stage: EStage.Observe, nudge: 0 }

/**
 * The port is constructed here and never injected: this plugin is what supplies `PullRequestPort`,
 * so asking the container for one would be asking for its own contribution.
 *
 * Which port is a session fact, decided once: a serve process answers through the sandbox route
 * with its thread-scoped token, a signed-in operator session through the user route, and anything
 * else keeps the `gh` poller as the degraded mode. Nothing starts in the constructor. The loader
 * builds every native before shadowing has decided which of them survive, so a poller armed here
 * would outlive a plugin that never loads.
 *
 * `contribute()` hands out no UI: the footer chip and sidebar section are React, and React lives
 * only in the TUI. `GithubUiBridgePort` is how the TUI reaches the same `service`/`facts`/`links`
 * this plugin builds, so a serve session that never renders anything still gets the hooks and the
 * durable link recording, and the TUI keeps the identical live poller it always had.
 */
export default class GithubPlugin extends NativePlugin {
  readonly id = 'github'

  constructor(
    private readonly args: {
      launchDirectory: string
      sessions: CloudSessionStore
      serve: CloudSession | null
      clientVersion: string
      cacheDirectory: string
      log: LogPort | null
    },
  ) {
    super()
  }

  /**
   * A cloud session (serve or signed-in operator) rides the SSE port: the API fans webhook
   * deliveries out to it in real time, so it pushes rather than polls, and a `gh` poller stands
   * behind it for as long as the API is unreachable. A signed-out operator
   * keeps the `gh` poller as degraded mode. The SSE port's `onReading` closes over the service
   * built after it — the deferred indirection is what lets the port outlive its own construction.
   */
  private port(
    onReading: (args: { key: string; reading: PullRequestReading }) => void,
    onPrEvent: (frame: PrEventFrame) => void,
    onAppInstallRecommended: ((recommendation: AppInstallRecommendation) => void) | undefined,
  ): FailoverPullRequestPort | GhPullRequestPort {
    const session = this.args.serve ?? this.args.sessions.read()
    if (session !== null) {
      const log = this.args.log === null ? {} : { log: { port: this.args.log } }
      return new FailoverPullRequestPort({
        primary: new SsePullRequestPort({
          session,
          clientVersion: this.args.clientVersion,
          onReading,
          onPrEvent,
          ...(onAppInstallRecommended === undefined ? {} : { onAppInstallRecommended }),
          ...log,
        }),
        fallback: new GhPullRequestPort(),
        ...log,
      })
    }

    return new GhPullRequestPort()
  }

  contribute(): PluginContribution {
    let service: PullRequestService | null = null
    let cached: CachedPullRequestPort | null = null
    let provider: PullRequestProvider | null = null
    const sink = new MutablePrEventSink()
    const appInstallSink = new MutableAppInstallSink()
    const raw = this.port(
      (pushed) => {
        service?.ingest(pushed)
        cached?.ingest(pushed)
      },
      (frame) => {
        provider?.onFrame(frame)
        sink.onPrEvent(frame)
      },
      (recommendation) => appInstallSink.onAppInstallRecommended(recommendation),
    )
    const adapter = new CachedPullRequestPort({ inner: raw, directory: this.args.cacheDirectory })
    cached = adapter
    const pollDiffer = createPollDiffer({ emit: (frame) => provider?.onFrame(frame) })
    service = createPullRequestService({ pullRequests: adapter, onPolled: pollDiffer.onPolled })
    const facts = createSessionFacts({ launchDirectory: this.args.launchDirectory })
    const cloudCheckout = createCloudCheckout()
    // The links the tracker drafts on a drop are read through a deferred indirection: tracking
    // holds the family map the links fold needs, and links holds the drafted-set the drop path
    // needs, so neither can be constructed first without one.
    let links: PullRequestLinks | null = null
    const tracking = createCheckoutTracking({
      service,
      facts,
      cloud: () => cloudCheckout.current(),
      linkDropped: (dropped) => links?.linkDropped(dropped) ?? [],
    })
    links = createPullRequestLinks({ service, tracker: tracking.tracker })
    const afterTool = new RefreshPullRequestAfterToolHook({ pullRequests: service })
    const afterShell = new RefreshPullRequestAfterShellHook({
      pullRequests: service,
      tracker: tracking.tracker,
    })
    const extra: PullRequestTarget[] = []
    const watchAll = (): void => service.watch({ links: links.projection.current(), extra })

    provider = createPullRequestProvider({
      tracker: tracking.tracker,
      service,
      onTargets: (targets) => {
        extra.splice(0, extra.length, ...targets)
        watchAll()
      },
    })
    const blockCiWatch = new BlockCiWatchBeforeToolHook({
      pullRequests: service,
      subscribed: (target) => provider?.subscribed(target) ?? false,
    })

    links.projection.subscribe(watchAll)

    /**
     * A serve process boots with no surface and may never take a turn, so the subscriptions the
     * restored log implies cannot wait for one. The projection seeding happens in the composition
     * root — it is the one holding the restored events — and this `boot` covers the half the log
     * cannot answer: which checkout the sandbox's launch directory is on. Only a pushing port is
     * asked: the signed-out `gh` poller's cadence is deliberate and gains no eager read here.
     */
    if (raw.pushes) void tracking.boot()

    return {
      promptFragments: [new CiFeedFragment()],
      hooks: [
        {
          phase: EHookPhase.BeforeTurn,
          name: 'follow-session',
          order: OBSERVE,
          run: facts.beforeTurn,
        },
        {
          phase: EHookPhase.BeforeTurn,
          name: 'track-checkout',
          order: OBSERVE,
          run: tracking.beforeTurn,
        },
        {
          phase: EHookPhase.AfterTurn,
          name: 'turn-ended',
          order: OBSERVE,
          run: facts.afterTurn,
        },
        {
          phase: EHookPhase.AfterTurn,
          name: 'follow-checkout',
          order: OBSERVE,
          run: tracking.afterTurn,
        },
        {
          phase: EHookPhase.AfterTurn,
          name: 'record-pull-request',
          order: OBSERVE,
          run: links.recordFound,
        },
        {
          phase: EHookPhase.OnThreadOpen,
          name: 'thread-opened',
          order: OBSERVE,
          run: facts.threadOpened,
        },
        {
          phase: EHookPhase.OnThreadOpen,
          name: 'forget-thread-links',
          order: OBSERVE,
          run: links.forgetThread,
        },
        {
          phase: EHookPhase.OnThreadOpen,
          name: 'track-thread-checkout',
          order: OBSERVE,
          run: tracking.threadOpened,
        },
        {
          phase: EHookPhase.AfterTool,
          name: 'follow-worktree',
          order: OBSERVE,
          run: facts.followWorktree,
        },
        {
          phase: EHookPhase.AfterTool,
          name: 'track-worktree-checkout',
          order: OBSERVE,
          run: tracking.followWorktree,
        },
        {
          phase: EHookPhase.AfterTool,
          name: afterTool.name,
          order: afterTool.order,
          run: afterTool.run,
        },
        {
          phase: EHookPhase.AfterShell,
          name: afterShell.name,
          order: afterShell.order,
          run: afterShell.run,
        },
        {
          phase: EHookPhase.BeforeTool,
          name: blockCiWatch.name,
          order: blockCiWatch.order,
          run: blockCiWatch.run,
        },
      ],
      ports: [
        { token: PullRequestPort, use: adapter },
        { token: PrEventFrameSink, use: sink },
        { token: AppInstallRecommendationSink, use: appInstallSink },
        {
          token: GithubUiBridgePort,
          use: {
            service,
            facts,
            links: links.projection,
            cloudCheckout,
            badges: adapter,
            checkoutFor: tracking.tracker.checkoutFor,
          },
        },
      ],
      projections: [links.projection, cloudCheckout],
      subscriptionProviders: [provider],
      dispose: () => {
        if (raw instanceof FailoverPullRequestPort) raw.dispose()
        cached?.dispose()
        service.dispose()
      },
    }
  }
}

export function registerPlugin({ container }: { container: DependencyContainer }): void {
  container.register(portToken(NativePlugin), {
    useFactory: (resolver) =>
      new GithubPlugin({
        launchDirectory: resolver.resolve(WorkspaceRoot),
        sessions: resolver.resolve(CloudSessionStoreToken),
        serve: container.isRegistered(ServeSessionToken, true)
          ? resolver.resolve(ServeSessionToken)
          : null,
        clientVersion: resolver.resolve(ClientVersionToken),
        cacheDirectory: resolver.resolve(AtlasHomeToken),
        log: container.isRegistered(registeredPortToken(LogPort), true)
          ? resolver.resolve(registeredPortToken(LogPort))
          : null,
      }),
  })
}
