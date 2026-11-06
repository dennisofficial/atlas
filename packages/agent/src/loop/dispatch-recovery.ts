import {
  crashedCallsOf,
  EToolEffect,
  type IdPort,
  type PendingCall,
  type ThreadId,
} from '@dltech/atlas-core'

import type { AgentRecordPort } from '../record/agent-record.port'

type CrashLog = Pick<AgentRecordPort, 'loopState' | 'append'>
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
  record: CrashLog
  ids: CrashIds
  threadId: ThreadId
  effectOf: ToolEffectResolver
}): Promise<readonly PendingCall[]> {
  const crashed = crashedCallsOf(await args.record.loopState({ threadId: args.threadId }))
  if (crashed.length === 0) return crashed

  const unrecoverable = crashed.filter((call) => args.effectOf(call.name) !== EToolEffect.Read)
  if (unrecoverable.length === 0) return crashed

  await args.record.append({
    threadId: args.threadId,
    runId: args.ids.nextRunId(),
    drafts: unrecoverable.map((call) => crashedCallDraft(call)),
  })
  return crashed
}
