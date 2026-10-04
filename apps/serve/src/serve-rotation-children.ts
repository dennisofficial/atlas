import { EAgentStatus, isResumable, outstandingApproval, type EventId, type ThreadId } from '@dltech/atlas-core'

import type { ServeApp } from './serve-app'
import { EServeEvent, type ServeLog } from './serve-log'

export async function trackRotationChildren(args: {
  app: ServeApp
  root: ThreadId
  children: readonly ThreadId[]
  consume: (children: readonly ThreadId[]) => Promise<void>
  log: ServeLog
}) {
  const tracked = new Map<ThreadId, { owner: ThreadId; marker: EventId | undefined }>()
  for (const child of args.children) {
    let current = child
    let owner: ThreadId | undefined
    const visited = new Set<ThreadId>()
    while (current !== args.root && !visited.has(current)) {
      visited.add(current)
      const thread = await args.app.threads.find({ threadId: current })
      if (thread?.id !== current || thread.agent === undefined) break
      owner ??= thread.agent.spawnedBy
      current = thread.agent.spawnedBy
    }
    if (current !== args.root || owner === undefined) throw new Error(`rotation child ${child} does not belong to ${args.root}`)
    const events = await args.app.log.readOwn({ threadId: owner })
    const marker = events.findLast((event) =>
      (event.type === 'agent-ended' || event.type === 'agent-restarted') && event.agentId === child)?.id
    tracked.set(child, { owner, marker })
  }

  const reconcile = async (): Promise<void> => {
    const completed: ThreadId[] = []
    for (const [child, prior] of tracked) {
      const parentEvents = await args.app.log.readOwn({ threadId: prior.owner })
      const marker = parentEvents.findLast((event) =>
        (event.type === 'agent-ended' || event.type === 'agent-restarted') && event.agentId === child)
      const terminalMarker = marker?.type === 'agent-ended' && marker.id !== prior.marker &&
        (marker.status === EAgentStatus.Finished || marker.status === EAgentStatus.Blocked || marker.status === EAgentStatus.Failed)
      const snapshot = args.app.roster?.snapshot().agents.find((agent) => agent.agentId === child)
      const events = await args.app.log.readOwn({ threadId: child })
      const lastReply = events.findLast((event) => event.type === 'assistant-said')
      const completedLog = snapshot?.status === EAgentStatus.Finished &&
        lastReply?.type === 'assistant-said' && lastReply.interrupted !== true &&
        outstandingApproval(events) === undefined && !isResumable(events)
      if (terminalMarker || completedLog) completed.push(child)
    }
    if (completed.length === 0) return
    await args.consume(completed)
    for (const child of completed) tracked.delete(child)
  }

  let checking = Promise.resolve()
  const handleChanged = (): void => {
    checking = checking.then(reconcile).catch((failure: unknown) => {
      args.log({ event: EServeEvent.CheckpointPersistFailed, reason: failure instanceof Error ? failure.message : String(failure) })
    })
  }
  const detach = [...new Set([...tracked.values()].map((child) => child.owner))].map((threadId) =>
    args.app.channel.subscribe({ threadId, listener: (signal) => {
      if (signal.type === 'events-appended' || signal.type === 'step-ended' || signal.type === 'turn-working') handleChanged()
    } }),
  )
  const unsubscribeRoster = args.app.roster?.subscribe(handleChanged)
  handleChanged()
  return {
    changed: handleChanged,
    settled: (): Promise<void> => checking,
    detach: (): void => { for (const off of detach) off(); unsubscribeRoster?.() },
  }
}
