import { createHash, randomUUID } from 'node:crypto'

import { AsyncLocalStorage } from 'node:async_hooks'

import { ToolDispatcher, type DispatchArgs, type DispatchableCall } from '@dltech/atlas-agent'
import { CallInterruptedError, type EventDraft, type StepFact } from '@dltech/atlas-core'
import { callKeySchema } from '@dltech/atlas-protocol'

import { interruptedMessage } from './errors'

type CallScope = {
  scopeKey: string
  callId?: string | undefined
  next: number
  consumed: Set<string>
  recorded?: readonly StepFact[] | undefined
  detachOnHandoff: boolean
  dispatchedBootId?: string | undefined
  attachOnly?: boolean | undefined
}

const storage = new AsyncLocalStorage<CallScope>()

export const scopeKeyOf = (args: { runId: string; callId: string }): string => {
  if (callKeySchema.safeParse(args.callId).success) return args.callId
  return `h${createHash('sha256').update(args.callId).digest('hex').slice(0, 16)}`
}

export const scopeKey = (): string | undefined => storage.getStore()?.scopeKey

export const scopeCallId = (): string | undefined => storage.getStore()?.callId

export const scopeNextSlot = (): number => storage.getStore()?.next ?? 0

export const scopeConsumedKeys = (): ReadonlySet<string> | undefined => storage.getStore()?.consumed

export const scopeRecordedSteps = (): readonly StepFact[] | undefined =>
  storage.getStore()?.recorded

export const rememberRecordedSteps = (facts: readonly StepFact[]): void => {
  const scope = storage.getStore()
  if (scope !== undefined) scope.recorded = [...facts]
}

export const claimStepSlot = (args: { key: string; index: number }): void => {
  const scope = storage.getStore()
  if (scope === undefined) return
  scope.consumed.add(args.key)
  scope.next = Math.max(scope.next, args.index + 1)
}

export const markDispatched = (args: { bootId: string }): void => {
  const scope = storage.getStore()
  if (scope !== undefined) scope.dispatchedBootId = args.bootId
}

export const scopeDispatchedBootId = (): string | undefined => storage.getStore()?.dispatchedBootId

export const runInCallScope = <T>(args: {
  scopeKey: string
  callId?: string | undefined
  attachOnly?: boolean | undefined
  detachOnHandoff?: boolean | undefined
  body(): T
}): T =>
  storage.run(
    {
      scopeKey: args.scopeKey,
      ...(args.callId === undefined ? {} : { callId: args.callId }),
      next: 0,
      consumed: new Set(),
      detachOnHandoff: args.detachOnHandoff ?? true,
      ...(args.attachOnly === undefined ? {} : { attachOnly: args.attachOnly }),
    },
    args.body,
  )

export const scopeAttachOnly = (): boolean => storage.getStore()?.attachOnly === true

export const scopeDetachOnHandoff = (): boolean => storage.getStore()?.detachOnHandoff === true

export const nextKey = (): string => {
  const scope = storage.getStore()
  if (scope === undefined) return `host-${randomUUID()}`
  const key = `${scope.scopeKey}.${scope.next}`
  scope.next += 1
  return key
}

const randomKeyOf = (prefix: string): string => {
  const scope = storage.getStore()
  if (scope === undefined) return `host-${prefix}-${randomUUID()}`
  return `${scope.scopeKey}.${prefix}.${randomUUID().slice(0, 8)}`
}

export const readKey = (): string => randomKeyOf('read')

export const noStepKey = (): string => randomKeyOf('no-step')

export class ScopedToolDispatcher extends ToolDispatcher {
  constructor(private readonly args: { inner: ToolDispatcher; daemonTools: ReadonlySet<string> }) {
    super()
  }

  dispatch(args: DispatchArgs): Promise<readonly EventDraft[]> {
    const scope: CallScope = {
      scopeKey: scopeKeyOf({ runId: args.call.runId, callId: args.call.callId }),
      callId: args.call.callId,
      next: 0,
      consumed: new Set(),
      detachOnHandoff: this.args.daemonTools.has(args.call.name),
    }
    return storage.run(scope, async () => {
      try {
        return await this.args.inner.dispatch(args)
      } catch (error) {
        if (!(error instanceof CallInterruptedError)) throw error
        const interrupted: EventDraft = {
          type: 'tool-result',
          callId: args.call.callId,
          name: args.call.name,
          output: undefined,
          error: { message: error.modelMessage ?? interruptedMessage(args.call.name) },
          interrupted: true,
        }
        return [interrupted]
      }
    })
  }
}

export const dispatchableScopeKey = (call: DispatchableCall): string =>
  scopeKeyOf({ runId: call.runId, callId: call.callId })
