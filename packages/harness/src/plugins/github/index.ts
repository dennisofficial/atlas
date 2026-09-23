import { EHookPhase, EStage, type HookOrder } from '@dltech/atlas-core'
import type { CloudSession, CloudSessionStore } from '../../cloud/cloud-session'
import { EPullRequestRoute, PullRequestsClient } from '../../cloud/pull-requests-client'
import { portToken, type DependencyContainer } from '../../container/injection'
import {
  ClientVersionToken,
  CloudSessionStoreToken,
  ServeSessionToken,
  WorkspaceRoot,
} from '../../container/tokens'

import { NativePlugin, type PluginContribution } from '../plugin'
import { ApiPullRequestPort } from './api-pull-requests'
import { createCloudCheckout } from './cloud-checkout'
import { GhPullRequestPort } from './gh-pull-requests'
import { RefreshPullRequestAfterShellHook, RefreshPullRequestAfterToolHook } from './hooks'
import { createPullRequestLinks } from './links'
import { createPullRequestService } from './pull-request-service'
import { PullRequestPort } from './pure'
import { createSessionFacts } from './session'
import { createCheckoutTracking } from './tracking'
import { GithubUiBridgePort } from './ui-bridge'

const OBSERVE: HookOrder = { stage: EStage.Observe, nudge: 0 }

const apiPort = (args: {
  session: CloudSession
  route: EPullRequestRoute
  clientVersion: string
}): ApiPullRequestPort =>
  new ApiPullRequestPort({
    client: new PullRequestsClient({
      url: args.session.url,
      token: args.session.token,
      route: args.route,
      clientVersion: args.clientVersion,
    }),
  })

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
    },
  ) {
    super()
  }

  private port(): PullRequestPort {
    if (this.args.serve !== null) {
      return apiPort({
        session: this.args.serve,
        route: EPullRequestRoute.Sandbox,
        clientVersion: this.args.clientVersion,
      })
    }

    const session = this.args.sessions.read()
    if (session === null) return new GhPullRequestPort()

    return apiPort({
      session,
      route: EPullRequestRoute.User,
      clientVersion: this.args.clientVersion,
    })
  }

  contribute(): PluginContribution {
    const adapter = this.port()
    const service = createPullRequestService({ pullRequests: adapter })
    const facts = createSessionFacts({ launchDirectory: this.args.launchDirectory })
    const links = createPullRequestLinks({ service })
    const cloudCheckout = createCloudCheckout()
    const tracking = createCheckoutTracking({ service, facts })
    const afterTool = new RefreshPullRequestAfterToolHook({ pullRequests: service })
    const afterShell = new RefreshPullRequestAfterShellHook({ pullRequests: service })

    links.projection.subscribe(() => service.watch({ links: links.projection.current() }))

    return {
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
      ],
      ports: [
        { token: PullRequestPort, use: adapter },
        { token: GithubUiBridgePort, use: { service, facts, links: links.projection, cloudCheckout } },
      ],
      projections: [links.projection, cloudCheckout],
      dispose: () => service.dispose(),
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
      }),
  })
}
