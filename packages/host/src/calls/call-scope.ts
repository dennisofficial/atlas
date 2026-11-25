import { createHash, randomUUID } from 'node:crypto'

import { AsyncLocalStorage } from 'node:async_hooks'

import { ToolDispatcher, type DispatchArgs, type DispatchableCall } from '@dltech/atlas-agent'
import { CallInterruptedError, type EventDraft } from '@dltech/atlas-core'
import { callKeySchema, type CallOp } from '@dltech/atlas-protocol'

import { interruptedMessage } from './errors'
import { opIdentityOf } from './op-identity'

type CallScope = {
  scopeKey: string
  callId?: string | undefined
  next: number
  seen: Map<string, number>
  tool?: string | undefined
  dispatchedBootId?: string | undefined
  attachOnly?: boolean | undefined
}

const storage = new AsyncLocalStorage<CallScope>()

export const scopeKeyOf = (args: { runId: string; callId: string }): string => {
  const plain = `${args.runId}:${args.callId}`
  if (callKeySchema.safeParse(plain).success) return plain
  const digest = createHash('sha256').update(args.callId).digest('hex').slice(0, 16)
  return `${args.runId}:h${digest}`
}

export const markDispatched = (args: { bootId: string }): void => {
  const scope = storage.getStore()
  if (scope !== undefined) scope.dispatchedBootId = args.bootId
}

export const scopeDispatchedBootId = (): string | undefined => storage.getStore()?.dispatchedBootId

export const scopeToolName = (): string | undefined => storage.getStore()?.tool

export const scopeCallId = (): string | undefined => storage.getStore()?.callId

export const runInCallScope = <T>(args: {
  scopeKey: string
  attachOnly?: boolean | undefined
  body(): T
}): T =>
  storage.run(
    {
      scopeKey: args.scopeKey,
      next: 0,
      seen: new Map(),
      ...(args.attachOnly === undefined ? {} : { attachOnly: args.attachOnly }),
    },
    args.body,
  )

export const scopeAttachOnly = (): boolean => storage.getStore()?.attachOnly === true

export const nextKey = (): string => {
  const scope = storage.getStore()
  if (scope === undefined) return `host-${randomUUID()}`
  const key = `${scope.scopeKey}.${scope.next}`
  scope.next += 1
  return key
}

export const scopedOpKey = (op: CallOp): string => {
  const identity = opIdentityOf(op)
  const scope = storage.getStore()
  if (scope === undefined) return `host-op-${identity}.0`
  const seen = scope.seen.get(identity) ?? 0
  scope.seen.set(identity, seen + 1)
  return `${scope.scopeKey}.${identity}.${seen}`
}

export class ScopedToolDispatcher extends ToolDispatcher {
  constructor(private readonly inner: ToolDispatcher) {
    super()
  }

  dispatch(args: DispatchArgs): Promise<readonly EventDraft[]> {
    const scope: CallScope = {
      scopeKey: scopeKeyOf({ runId: args.call.runId, callId: args.call.callId }),
      callId: args.call.callId,
      next: 0,
      seen: new Map(),
      tool: args.call.name,
    }
    return storage.run(scope, async () => {
      try {
        return await this.inner.dispatch(args)
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
