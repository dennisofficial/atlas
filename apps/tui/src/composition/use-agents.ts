import { EShellStatus, type ProviderIdentity, type ThreadId } from '@dltech/atlas-core'
import {
  EPullRequestState,
  TEAMMATE_AGENT_TYPE,
  type AgentSnapshot,
  type PullRequestBadge,
} from '@dltech/atlas-harness'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

export const sameShellSurfaces = (
  left: readonly ShellSnapshot[],
  right: readonly ShellSnapshot[],
): boolean => {
  if (left.length !== right.length) return false

  return left.every((shell, index) => {
    const other = right[index]
    return (
      other !== undefined &&
      shell.shellId === other.shellId &&
      shell.threadId === other.threadId &&
      shell.status === other.status
    )
  })
}

export function useShellSurfaces(shells: readonly ShellSnapshot[]): readonly ShellSnapshot[] {
  const [held, setHeld] = useState(shells)

  useEffect(() => {
    setHeld((current) => (sameShellSurfaces(current, shells) ? current : shells))
  }, [shells])

  return held
}

import { crewPullRequestOf } from '../plugins/github/crew-pull-request'
import { standingsOfCrew, type CrewMember } from '../store/crew-retirement'
import { NO_VISITS, lastVisitOf, recordDeparture, type CrewVisits } from '../store/crew-visits'
import { withCrew, type SidebarModel } from '../store/sidebar-model'
import { isSubagentWorking, subagentRows, subagentShowsElapsed } from '../store/subagent-row'
import { modelLabel } from '../ui/model-label'
import type { AtlasApp } from './compose'
import type { ShellSnapshot } from '@dltech/atlas-harness'
import { useTickingNow } from './use-ticking-now'

const NO_SUBSCRIPTION = (): (() => void) => () => undefined
const NO_VERSION = (): number => 0

export type AgentsControl = {
  sidebar: SidebarModel
  own: readonly AgentSnapshot[]
  everywhere: readonly AgentSnapshot[]
  visits: CrewVisits
  running: number
  count: number
}

/**
 * The departure is recorded by the effect's cleanup rather than by watching the next value, so a
 * child that is still open holds no reading at all, so a failure counts as acknowledged only once
 * the operator has actually left it.
 */
function useCrewVisits(viewing: ThreadId | null): CrewVisits {
  const [visits, setVisits] = useState<CrewVisits>(NO_VISITS)

  useEffect(() => {
    if (viewing === null) return

    return () => {
      setVisits((held) =>
        recordDeparture({ visits: held, leaving: viewing, at: new Date().toISOString() }),
      )
    }
  }, [viewing])

  return visits
}

const SETTLED_PULL_REQUESTS: readonly EPullRequestState[] = [
  EPullRequestState.Merged,
  EPullRequestState.Closed,
]

const hasOpenPullRequest = (args: {
  snapshot: AgentSnapshot
  pullRequestOf: (args: { threadId: ThreadId }) => PullRequestBadge | null
}): boolean => {
  if (args.snapshot.agentType !== TEAMMATE_AGENT_TYPE) return false

  const badge = args.pullRequestOf({ threadId: args.snapshot.agentId })
  return badge !== null && !SETTLED_PULL_REQUESTS.includes(badge.state)
}

const crewMembersOf = (args: {
  snapshots: readonly AgentSnapshot[]
  visits: CrewVisits
  shellBusy: ReadonlySet<ThreadId>
  pullRequestOf: (args: { threadId: ThreadId }) => PullRequestBadge | null
}): readonly CrewMember[] =>
  args.snapshots.map((snapshot) => ({
    agentId: snapshot.agentId,
    spawnedBy: snapshot.spawnedBy,
    status: snapshot.status,
    deliveredAt: snapshot.deliveredAt ?? null,
    lastViewedAt: lastVisitOf({ visits: args.visits, id: snapshot.agentId }),
    holdingShells: args.shellBusy.has(snapshot.agentId),
    hasOpenPullRequest: hasOpenPullRequest({ snapshot, pullRequestOf: args.pullRequestOf }),
  }))

/**
 * Every state change of a child is an event the registry already announces, so the sidebar reads
 * the held listing rather than polling one out of it the way a background shell has to be polled.
 *
 * The scoped listing is what a conversation may see; the unscoped one exists for the exit guard
 * alone, because quitting stops every child whoever spawned it.
 */
export function useAgents({
  app,
  threadId,
  sidebar,
  viewing,
  shells,
}: {
  app: AtlasApp
  threadId: ThreadId
  sidebar: SidebarModel
  viewing: ThreadId | null
  shells: readonly ShellSnapshot[]
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

  const visits = useCrewVisits(viewing)
  const surfaces = useShellSurfaces(shells)
  const shellBusy = useMemo(() => {
    const busy = new Set(
      surfaces
        .filter((shell) => shell.status === EShellStatus.Running)
        .map((shell) => shell.threadId),
    )
    const parentOf = new Map(everywhere.map((child) => [child.agentId, child.spawnedBy]))
    for (const threadId of [...busy]) {
      let ancestor = parentOf.get(threadId)
      while (ancestor !== undefined && !busy.has(ancestor)) {
        busy.add(ancestor)
        ancestor = parentOf.get(ancestor)
      }
    }
    return busy
  }, [surfaces, everywhere])
  const pullRequestOf = useCallback(
    (args: { threadId: ThreadId }): PullRequestBadge | null =>
      crewPullRequests === null
        ? null
        : crewPullRequestOf({ reader: crewPullRequests, threadId: args.threadId }),
    [crewPullRequests],
  )
  const members = useMemo(
    () => crewMembersOf({ snapshots: own, visits, shellBusy, pullRequestOf }),
    [own, pullRequestOf, pullRequestVersion, shellBusy, visits],
  )

  const now = useTickingNow(own.some(subagentShowsElapsed))

  const crew = useMemo(() => {
    const nameModel = (model: ProviderIdentity): string =>
      app.models.cardFor({ providerId: model.id, modelId: model.modelId })?.label ??
      modelLabel(model.modelId)
    const subagents = subagentRows({
      snapshots: own,
      now,
      modelLabel: nameModel,
      viewing,
      rosters: { shells: surfaces, children: everywhere },
      pullRequestOf,
    })
    const standings = standingsOfCrew({ crew: members, viewing })

    return {
      standings,
      subagents,
      running: subagents.filter(isSubagentWorking).length,
    }
  }, [
    app.models,
    everywhere,
    members,
    now,
    own,
    pullRequestOf,
    pullRequestVersion,
    surfaces,
    viewing,
  ])

  return useMemo(
    () => ({
      sidebar: withCrew({ model: sidebar, subagents: crew.subagents, standings: crew.standings }),
      own,
      everywhere,
      visits,
      running: crew.running,
      count: crew.subagents.length,
    }),
    [crew, everywhere, own, sidebar, visits],
  )
}
