import type { EventOfType } from '@dltech/atlas-core'

import { scopeKeyOf } from './call-scope'

export type CancelDebt = { key: string; bootId?: string | undefined }

export type StepKey = { key: string; bootId?: string | undefined }

export type SteppedLogEvent = EventOfType<'tool-dispatched'> | EventOfType<'tool-result'>

type Dispatched = { name: string; bootId?: string | undefined }

const dispatchedOf = (events: readonly SteppedLogEvent[]): Map<string, Dispatched> => {
  const dispatched = new Map<string, Dispatched>()
  for (const event of events) {
    if (event.type !== 'tool-dispatched') continue
    dispatched.set(event.callId, {
      name: event.name,
      ...(event.bootId === undefined ? {} : { bootId: event.bootId }),
    })
  }
  return dispatched
}

const withoutBoot = (key: string, bootId: string | undefined): CancelDebt =>
  bootId === undefined ? { key } : { key, bootId }

export const cancelDebtsOf = (args: {
  events: readonly SteppedLogEvent[]
  stepsOf(scopeKey: string): readonly StepKey[]
  daemonTools: ReadonlySet<string>
}): readonly CancelDebt[] => {
  const dispatched = dispatchedOf(args.events)
  const debts: CancelDebt[] = []
  for (const event of args.events) {
    if (event.type !== 'tool-result' || event.interrupted !== true) continue
    const call = dispatched.get(event.callId)
    const scopeKey = scopeKeyOf({ runId: event.runId, callId: event.callId })
    const steps = args.stepsOf(scopeKey)
    if (steps.length === 0) {
      if (call === undefined || !args.daemonTools.has(call.name)) continue
      debts.push(withoutBoot(`${scopeKey}.0`, call.bootId))
      continue
    }
    for (const step of steps) debts.push(withoutBoot(step.key, step.bootId ?? call?.bootId))
  }
  return debts
}
