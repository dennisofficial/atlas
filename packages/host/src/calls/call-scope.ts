import { createHash, randomUUID } from 'node:crypto'

import { AsyncLocalStorage } from 'node:async_hooks'

import { ToolDispatcher, type DispatchArgs, type DispatchableCall } from '@dltech/atlas-agent'
import type { EventDraft } from '@dltech/atlas-core'
import { callKeySchema } from '@dltech/atlas-protocol'

type CallScope = { scopeKey: string; next: number; dispatchedBootId?: string | undefined }

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
    return runInCallScope({
      scopeKey: scopeKeyOf({ runId: args.call.runId, callId: args.call.callId }),
      body: () => this.inner.dispatch(args),
    })
  }
}

export const dispatchableScopeKey = (call: DispatchableCall): string =>
  scopeKeyOf({ runId: call.runId, callId: call.callId })
