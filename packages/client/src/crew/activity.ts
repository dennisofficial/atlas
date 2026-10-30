import { EShellStatus, type EAgentStatus } from '@dltech/atlas-core'

import { isSubagentAlive, type CrewActivity } from './readout'

export type CrewRosters = {
  shells: readonly { threadId: string; status: EShellStatus }[]
  children: readonly {
    agentId: string
    spawnedBy: string
    status: EAgentStatus
  }[]
}

export function crewActivityOf(args: {
  id: string
  rosters: CrewRosters
}): CrewActivity | undefined {
  const shells = args.rosters.shells.filter(
    (shell) => shell.threadId === args.id && shell.status === EShellStatus.Running,
  ).length
  const subagents = args.rosters.children.filter(
    (child) =>
      child.spawnedBy === args.id &&
      (isSubagentAlive(child) ||
        crewActivityOf({ id: child.agentId, rosters: args.rosters }) !== undefined),
  ).length

  if (shells === 0 && subagents === 0) return undefined
  return { shells, subagents }
}

export function shellBusyThreads(args: CrewRosters): ReadonlySet<string> {
  const busy = new Set(
    args.shells.filter((shell) => shell.status === EShellStatus.Running).map((s) => s.threadId),
  )
  const parentOf = new Map(args.children.map((child) => [child.agentId, child.spawnedBy]))
  for (const threadId of [...busy]) {
    let ancestor = parentOf.get(threadId)
    while (ancestor !== undefined && !busy.has(ancestor)) {
      busy.add(ancestor)
      ancestor = parentOf.get(ancestor)
    }
  }
  return busy
}
