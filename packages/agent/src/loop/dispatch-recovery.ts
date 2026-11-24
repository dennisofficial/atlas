import {
  crashedCallsOf,
  EToolEffect,
  recoverCall,
  type IdPort,
  type PendingCall,
  type RecoverAnswer,
  type ThreadId,
} from '@dltech/atlas-core'

import type { AgentRecordPort } from '../record/agent-record.port'

type CrashLog = Pick<AgentRecordPort, 'loopState' | 'append'>
type CrashIds = Pick<IdPort, 'nextRunId'>

export type ToolEffectResolver = (name: string) => EToolEffect | undefined

export type PodHoldProbe = {
  dispatchedBootId(callId: string): string | undefined
  podAnswer(call: PendingCall): Promise<RecoverAnswer>
  daemonBootId(): string | undefined
}

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

const restartProven = async (args: {
  call: PendingCall
  probe: PodHoldProbe
}): Promise<boolean> => {
  const dispatchedBootId = args.probe.dispatchedBootId(args.call.callId)
  if (dispatchedBootId === undefined) return false
  const action = recoverCall({
    facts: { dispatched: true, dispatchedBootId, resultRecorded: false, readOnly: false },
    answer: await args.probe.podAnswer(args.call),
    bootId: args.probe.daemonBootId() ?? '',
    variant: { doneRuns: true },
  })
  return action.type === 'interrupted'
}

export async function settleCrashedCalls(args: {
  record: CrashLog
  ids: CrashIds
  threadId: ThreadId
  effectOf: ToolEffectResolver
  probe?: PodHoldProbe | undefined
}): Promise<readonly PendingCall[]> {
  const crashed = crashedCallsOf(await args.record.loopState({ threadId: args.threadId }))
  if (crashed.length === 0) return crashed

  const unrecoverable = crashed.filter((call) => args.effectOf(call.name) !== EToolEffect.Read)
  const settled: PendingCall[] = []
  for (const call of unrecoverable) {
    if (args.probe !== undefined && !(await restartProven({ call, probe: args.probe }))) continue
    settled.push(call)
  }
  if (settled.length === 0) return crashed

  await args.record.append({
    threadId: args.threadId,
    runId: args.ids.nextRunId(),
    drafts: settled.map((call) => crashedCallDraft(call)),
  })
  return crashed
}
