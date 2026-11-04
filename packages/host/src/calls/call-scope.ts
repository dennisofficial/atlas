import { createHash, randomUUID } from 'node:crypto'

import { AsyncLocalStorage } from 'node:async_hooks'

import { ToolDispatcher, type DispatchArgs, type DispatchableCall } from '@dltech/atlas-agent'
import type { EventDraft } from '@dltech/atlas-core'
import { callKeySchema } from '@dltech/atlas-protocol'

import { interruptedMessage } from './errors'

type CallScope = {
  scopeKey: string
  next: number
  dispatchedBootId?: string | undefined
  interrupted?: boolean | undefined
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

export const markInterrupted = (): void => {
  const scope = storage.getStore()
  if (scope !== undefined) scope.interrupted = true
}

export const runInCallScope = <T>(args: { scopeKey: string; body(): T }): T =>
  storage.run({ scopeKey: args.scopeKey, next: 0 }, args.body)

export const nextKey = (): string => {
  const scope = storage.getStore()
  if (scope === undefined) return `host-${randomUUID()}`
  const key = `${scope.scopeKey}.${scope.next}`
  scope.next += 1
  return key
}

export class ScopedToolDispatcher extends ToolDispatcher {
  constructor(private readonly inner: ToolDispatcher) {
    super()
  }

  dispatch(args: DispatchArgs): Promise<readonly EventDraft[]> {
    const scope: CallScope = {
      scopeKey: scopeKeyOf({ runId: args.call.runId, callId: args.call.callId }),
      next: 0,
    }
    return storage.run(scope, async () => {
      const drafts = await this.inner.dispatch(args)
      if (scope.interrupted !== true) return drafts
      return drafts.map((draft) => {
        if (draft.type !== 'tool-result' || draft.callId !== args.call.callId) return draft
        return {
          ...draft,
          output: undefined,
          error: { message: interruptedMessage(args.call.name) },
          interrupted: true,
        }
      })
    })
  }
}

export const dispatchableScopeKey = (call: DispatchableCall): string =>
  scopeKeyOf({ runId: call.runId, callId: call.callId })
