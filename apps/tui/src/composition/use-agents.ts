import type { ThreadId } from '@dltech/atlas-core'
import type { AgentSnapshot, PullRequestBadge } from '@dltech/atlas-harness'
import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { crewPullRequestOf } from '../plugins/github/crew-pull-request'
import { withCrew, type SidebarModel } from '../store/sidebar-model'
import { isAgentLive, isAgentTicking, subagentRows } from '../store/subagent-row'
import type { AtlasApp } from './compose'
import { useTickingNow } from './use-ticking-now'

const NO_SUBSCRIPTION = (): (() => void) => () => undefined
const NO_VERSION = (): number => 0

export type AgentsControl = {
  sidebar: SidebarModel
  own: readonly AgentSnapshot[]
  everywhere: readonly AgentSnapshot[]
  running: number
  count: number
}

/**
 * The scoped listing is what a conversation may see; the unscoped one is what quitting acts on,
 * because quitting stops every child whoever spawned it. `running` counts the unscoped listing so
 * the quit prompt and the guard's rows can never disagree.
 */
export function useAgents({
  app,
  threadId,
  sidebar,
  viewing,
}: {
  app: AtlasApp
  threadId: ThreadId
  sidebar: SidebarModel
  viewing: ThreadId | null
}): AgentsControl {
  const agents = app.agents

  const subscribe = useCallback((listener: () => void) => agents.onChange(listener), [agents])
  const readOwn = useCallback(() => agents.list({ threadId }), [agents, threadId])
  const readEverywhere = useCallback(() => agents.listEverywhere(), [agents])

  const own = useSyncExternalStore(subscribe, readOwn)
  const everywhere = useSyncExternalStore(subscribe, readEverywhere)

  const crewPullRequests = app.crewPullRequests ?? null
  const pullRequestVersion = useSyncExternalStore(
    crewPullRequests?.service.subscribe ?? NO_SUBSCRIPTION,
    crewPullRequests?.service.version ?? NO_VERSION,
  )

  const pullRequestOf = useCallback(
    (args: { threadId: ThreadId }): PullRequestBadge | null =>
      crewPullRequests === null
        ? null
        : crewPullRequestOf({ reader: crewPullRequests, threadId: args.threadId }),
    [crewPullRequests],
  )

  const now = useTickingNow(own.some(isAgentTicking))

  const subagents = useMemo(
    () => subagentRows({ snapshots: own, now, viewing, pullRequestOf }),
    [now, own, pullRequestOf, pullRequestVersion, viewing],
  )
  const running = useMemo(() => everywhere.filter(isAgentLive).length, [everywhere])

  return useMemo(
    () => ({
      sidebar: withCrew({ model: sidebar, subagents }),
      own,
      everywhere,
      running,
      count: subagents.length,
    }),
    [everywhere, own, running, sidebar, subagents],
  )
}
