import { EHookPhase, EStage, LogPort, type HookOrder } from '@dltech/atlas-core'
import type { CloudSession, CloudSessionStore } from '../../cloud/cloud-session'
import { portToken, type DependencyContainer } from '../../container/injection'
import type { PrEventFrame } from '../../cloud/pr-event-frame'
import { SsePullRequestPort } from '../../cloud/sse-pull-requests'
import {
  AtlasHomeToken,
  ClientVersionToken,
  CloudSessionStoreToken,
  ServeSessionToken,
  WorkspaceRoot,
} from '../../container/tokens'

import { NativePlugin, type PluginContribution } from '../plugin'
import { BlockCiWatchBeforeToolHook } from './ci-watch-hook'
import { CiFeedFragment } from './ci-feed-fragment'
import { createCloudCheckout } from './cloud-checkout'
import { GhPullRequestPort } from './gh-pull-requests'
import { RefreshPullRequestAfterShellHook, RefreshPullRequestAfterToolHook } from './hooks'
import { createPullRequestLinks } from './links'
import { createPollDiffer } from './pr-event-diff'
import { createPrEventRouting, type PrEventRouting } from './pr-event-routing'
import { PrEventNoticeQueue, prEventIntakeSource } from './pr-event-queue'
import { MutablePrEventSink, PrEventFrameSink } from './pr-event-sink'
import { CachedPullRequestPort } from './pull-request-cache-port'
import { createPullRequestService, type PullRequestService } from './pull-request-service'
import { createPullRequestTransitions } from './pr-transitions'
import { PullRequestPort, type PullRequestReading } from './pure'
import { createSessionFacts } from './session'

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
   * deliveries out to it in real time, so it pushes rather than polls. A signed-out operator
   * keeps the `gh` poller as degraded mode. The SSE port's `onReading` closes over the service
   * built after it — the deferred indirection is what lets the port outlive its own construction.
   */
  private port(
    onReading: (args: { key: string; reading: PullRequestReading }) => void,
    onPrEvent: (frame: PrEventFrame) => void,
  ): PullRequestPort {
    const session = this.args.serve ?? this.args.sessions.read()
    if (session !== null) {
      return new SsePullRequestPort({
        session,
        clientVersion: this.args.clientVersion,
        onReading,
        onPrEvent,
        ...(this.args.log === null ? {} : { log: { port: this.args.log } }),
      })
    }

    return new GhPullRequestPort()
  }

  contribute(): PluginContribution {
    let service: PullRequestService | null = null
    let cached: CachedPullRequestPort | null = null
    let routing: PrEventRouting | null = null
    const sink = new MutablePrEventSink()
    const raw = this.port(
      (pushed) => {
        service?.ingest(pushed)
        cached?.ingest(pushed)
      },
      (frame) => {
        routing?.onPrEvent(frame)
        sink.onPrEvent(frame)
      },
    )
    const adapter = new CachedPullRequestPort({ inner: raw, directory: this.args.cacheDirectory })
    cached = adapter
    const pollDiffer = createPollDiffer({ emit: (frame) => routing?.onPrEvent(frame) })
    service = createPullRequestService({ pullRequests: adapter, onPolled: pollDiffer.onPolled })
    const facts = createSessionFacts({ launchDirectory: this.args.launchDirectory })
    const links = createPullRequestLinks({ service })
    const cloudCheckout = createCloudCheckout()
    const tracking = createCheckoutTracking({ service, facts, cloud: () => cloudCheckout.current() })
    const afterTool = new RefreshPullRequestAfterToolHook({ pullRequests: service })
    const afterShell = new RefreshPullRequestAfterShellHook({ pullRequests: service })
    const transitions = createPullRequestTransitions({ service })
    const blockCiWatch = new BlockCiWatchBeforeToolHook({ pullRequests: service })

    const prEvents = new PrEventNoticeQueue()
    routing = createPrEventRouting({
      service,
      links: () => links.projection.current(),
      queue: prEvents,
    })

    links.projection.subscribe(() => service.watch({ links: links.projection.current() }))

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
          phase: EHookPhase.AfterTool,
          name: 'follow-worktree',
          order: OBSERVE,
          run: facts.followWorktree,
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
          phase: EHookPhase.BeforeTurn,
          name: 'seed-pull-request-transitions',
          order: OBSERVE,
          run: transitions.beforeTurn,
        },
        {
          phase: EHookPhase.BeforeTool,
          name: blockCiWatch.name,
          order: blockCiWatch.order,
          run: blockCiWatch.run,
        },
        {
          phase: EHookPhase.BeforeTurn,
          name: 'route-pr-events',
          order: OBSERVE,
          run: routing.beforeTurn,
        },
        {
          phase: EHookPhase.OnThreadOpen,
          name: 'route-pr-events-thread',
          order: OBSERVE,
          run: routing.threadOpened,
        },
      ],
      ports: [
        { token: PullRequestPort, use: adapter },
        { token: PrEventFrameSink, use: sink },
        {
          token: GithubUiBridgePort,
          use: { service, facts, links: links.projection, cloudCheckout, badges: adapter },
        },
      ],
      projections: [links.projection, cloudCheckout],
      intakeSources: [prEventIntakeSource(prEvents)],
      dispose: () => {
        if (raw instanceof SsePullRequestPort) raw.dispose()
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
        log: container.isRegistered(portToken(LogPort), true)
          ? resolver.resolve(portToken(LogPort))
          : null,
      }),
  })
}
