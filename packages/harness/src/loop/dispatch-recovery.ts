import {
  crashedCalls,
  EToolEffect,
  type EventLogPort,
  type IdPort,
  type PendingCall,
  type ThreadId,
} from '@dltech/atlas-core'

type CrashLog = Pick<EventLogPort, 'read' | 'append'>
type CrashIds = Pick<IdPort, 'nextRunId'>

export type ToolEffectResolver = (name: string) => EToolEffect | undefined

export function crashedCallDraft(call: PendingCall) {
  return {
    type: 'tool-result' as const,
    callId: call.callId,
    name: call.name,
    interrupted: true,
    error: {
      message: `${call.name} was interrupted by a process restart before its result was recorded; its effects are unknown — check before repeating it`,
    },
  }
}

export async function settleCrashedCalls(args: {
  log: CrashLog
  ids: CrashIds
  threadId: ThreadId
  effectOf: ToolEffectResolver
}): Promise<readonly PendingCall[]> {
  const events = await args.log.read({ threadId: args.threadId })
  const crashed = crashedCalls(events)
  if (crashed.length === 0) return crashed

  const unrecoverable = crashed.filter((call) => args.effectOf(call.name) !== EToolEffect.Read)
  if (unrecoverable.length === 0) return crashed

  await args.log.append({
    threadId: args.threadId,
    runId: args.ids.nextRunId(),
    drafts: unrecoverable.map((call) => crashedCallDraft(call)),
  })
  return crashed
}
