import { EHookPhase, EStage, type HookOrder } from '@dltech/atlas-core'
import { portToken, type DependencyContainer } from '../../container/injection'
import { WorkspaceRoot } from '../../container/tokens'

import { NativePlugin, type PluginContribution } from '../plugin'
import { GhPullRequestPort } from './gh-pull-requests'
import { RefreshPullRequestAfterShellHook, RefreshPullRequestAfterToolHook } from './hooks'
import { createPullRequestLinks } from './links'
import { createPullRequestService } from './pull-request-service'
import { PullRequestPort } from './pure'
import { createSessionFacts } from './session'
import { GithubUiBridgePort } from './ui-bridge'

const OBSERVE: HookOrder = { stage: EStage.Observe, nudge: 0 }

/**
 * The port is constructed here and never injected: this plugin is what supplies `PullRequestPort`,
 * so asking the container for one would be asking for its own contribution.
 *
 * Nothing starts in the constructor. The loader builds every native before shadowing has decided
 * which of them survive, so a poller armed here would outlive a plugin that never loads.
 *
 * `contribute()` hands out no UI: the footer chip and sidebar section are React, and React lives
 * only in the TUI. `GithubUiBridgePort` is how the TUI reaches the same `service`/`facts`/`links`
 * this plugin builds, so a serve session that never renders anything still gets the hooks and the
 * durable link recording, and the TUI keeps the identical live poller it always had.
 */
export default class GithubPlugin extends NativePlugin {
  readonly id = 'github'

  constructor(private readonly launchDirectory: string) {
    super()
  }

  contribute(): PluginContribution {
    const adapter = new GhPullRequestPort()
    const service = createPullRequestService({ pullRequests: adapter })
    const facts = createSessionFacts({ launchDirectory: this.launchDirectory })
    const links = createPullRequestLinks({ service })
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
          phase: EHookPhase.AfterTurn,
          name: 'turn-ended',
          order: OBSERVE,
          run: facts.afterTurn,
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
        { token: GithubUiBridgePort, use: { service, facts, links: links.projection } },
      ],
      projections: [links.projection],
      dispose: () => service.dispose(),
    }
  }
}

export function registerPlugin({ container }: { container: DependencyContainer }): void {
  container.register(portToken(NativePlugin), {
    useFactory: (resolver) => new GithubPlugin(resolver.resolve(WorkspaceRoot)),
  })
}
