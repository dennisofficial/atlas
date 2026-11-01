import { awaitsReply, EAgentStatus, type ThreadId } from '@dltech/atlas-core'

import type { ServeApp, ServeRoster } from './serve-app'
import { EServeEvent, type ServeLog } from './serve-log'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'pending child input failed for a reason it did not name'

const familyAgentsOf = (args: {
  root: ThreadId
  roster: ServeRoster['snapshot']
}): ReturnType<ServeRoster['snapshot']>['agents'] => {
  const family = new Set<string>([args.root])
  const agents = args.roster().agents
  let grew = true
  while (grew) {
    grew = false
    for (const agent of agents) {
      if (family.has(agent.agentId) || !family.has(agent.spawnedBy)) continue
      family.add(agent.agentId)
      grew = true
    }
  }
  return agents.filter((agent) => family.has(agent.agentId))
}

/**
 * Messages appended to a child thread while the pod was down arrive through hydration, not through
 * a client, so nobody asks the child to run them. Once the boot's roster hydration has happened,
 * wake every settled child whose durable log ends on an unanswered message; a running child is
 * mid-turn on exactly that input and is left alone.
 */
export async function wakeChildrenWithPendingInput(args: {
  app: Pick<ServeApp, 'log'> & {
    roster?: ServeRoster | undefined
    agents?: Pick<NonNullable<ServeApp['agents']>, 'wake'> | undefined
  }
  threadId: ThreadId
  log: ServeLog
}): Promise<readonly ThreadId[]> {
  const { app, threadId, log } = args
  if (app.roster === undefined || app.agents === undefined) return []

  const woken: ThreadId[] = []
  for (const child of familyAgentsOf({ root: threadId, roster: app.roster.snapshot })) {
    if (child.status === EAgentStatus.Running) continue
    const events = await app.log.readOwn({ threadId: child.agentId }).catch(() => [])
    if (events.length === 0 || !awaitsReply(events)) continue
    try {
      const outcome = await app.agents.wake({ agentId: child.agentId })
      if (outcome.ok) {
        woken.push(child.agentId)
        log({ event: EServeEvent.PendingChildInputWoken, agentId: child.agentId })
        continue
      }
      log({
        event: EServeEvent.PendingChildInputRefused,
        agentId: child.agentId,
        reason: outcome.reason,
      })
    } catch (error) {
      log({
        event: EServeEvent.PendingChildInputFailed,
        agentId: child.agentId,
        reason: messageOf(error),
      })
    }
  }
  return woken
}
