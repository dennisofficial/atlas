import {
  EOperatorInputOutcome,
  type EventDraft,
  type EventLogPort,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { DeltaChannel } from '../channel/delta-channel'
import type { DeliverOperatorInputArgs } from './deliver'
import type {
  OperatorInputAnswerOutcome,
  OperatorInputPending,
  OperatorInputPort,
  OperatorInputRequestArgs,
} from './port'

type Open = {
  request: OperatorInputPending
  args: OperatorInputRequestArgs
  resolve: (outcome: OperatorInputAnswerOutcome) => void
  ready: Promise<void>
  removeAbort: () => void
  delivering: boolean
  settling: boolean
}

export const OPERATOR_INPUT_CANCELLED = 'operator input request cancelled; if delivery had started, partial input may have reached the reader — restart the CLI with a fresh destination before requesting another value'

export class InProcessOperatorInput implements OperatorInputPort {
  private readonly open = new Map<ThreadId, Open>()

  constructor(private readonly deps: {
    log: Pick<EventLogPort, 'append'>
    ids: IdPort
    channel: () => DeltaChannel | undefined
    deliver: (args: DeliverOperatorInputArgs) => Promise<OperatorInputAnswerOutcome>
    onListenerError?: ((cause: unknown) => void) | undefined
  }) {}

  pending(args: { threadId: ThreadId }): OperatorInputPending | null {
    return this.open.get(args.threadId)?.request ?? null
  }

  request(args: OperatorInputRequestArgs): Promise<OperatorInputAnswerOutcome> {
    if (args.signal.aborted) return Promise.resolve({ ok: false, reason: OPERATOR_INPUT_CANCELLED })
    if (this.open.has(args.threadId)) {
      return Promise.resolve({ ok: false, reason: 'an operator input request is already pending for this thread' })
    }
    return new Promise((resolve) => {
      const request: OperatorInputPending = {
        requestId: args.requestId,
        description: args.description,
        path: args.path,
        ...(args.url === undefined ? {} : { url: args.url }),
      }
      const open: Open = {
        request, args, resolve,
        ready: Promise.resolve(),
        removeAbort: () => undefined,
        delivering: false,
        settling: false,
      }
      this.open.set(args.threadId, open)
      const handleAbort = () => {
        if (open.delivering) return
        void open.ready.then(() => {
          if (open.delivering) return
          return this.settle({
            open,
            outcome: EOperatorInputOutcome.Cancelled,
            result: { ok: false, reason: OPERATOR_INPUT_CANCELLED },
          })
        })
      }
      args.signal.addEventListener('abort', handleAbort, { once: true })
      open.removeAbort = () => args.signal.removeEventListener('abort', handleAbort)
      open.ready = this.append({
        threadId: args.threadId,
        drafts: [{ type: 'operator-input-requested', ...request }],
      }).then(
        () => {
          if (args.signal.aborted) { handleAbort(); return }
          this.publish({ threadId: args.threadId, request })
        },
        () => {
          this.clear(open)
          resolve({ ok: false, reason: 'could not record the operator input request' })
        },
      )
    })
  }

  async answer(args: {
    requestId: string
    value: string
    threadId?: ThreadId | undefined
  }): Promise<OperatorInputAnswerOutcome> {
    const open = [...this.open.values()].find((entry) => entry.request.requestId === args.requestId)
    if (open === undefined || (args.threadId !== undefined && args.threadId !== open.args.threadId)) {
      return { ok: false, reason: 'that operator input request is no longer waiting for an answer' }
    }
    await open.ready
    if (this.open.get(open.args.threadId) !== open || open.delivering || open.settling) {
      return { ok: false, reason: 'that request was already answered or cancelled' }
    }
    open.delivering = true
    const value = open.args.appendNewline && !args.value.endsWith('\n') ? `${args.value}\n` : args.value
    let result: OperatorInputAnswerOutcome
    try {
      result = await this.deps.deliver({
        path: open.request.path, value,
        threadId: open.args.threadId,
        cwd: open.args.cwd,
        signal: open.args.signal,
      })
    } catch {
      result = { ok: false, reason: 'operator input delivery failed' }
    }
    if (open.args.signal.aborted) result = { ok: false, reason: OPERATOR_INPUT_CANCELLED }
    const outcome = open.args.signal.aborted
      ? EOperatorInputOutcome.Cancelled
      : result.ok ? EOperatorInputOutcome.Delivered : EOperatorInputOutcome.Undelivered
    return await this.settle({ open, outcome, result })
  }

  private async settle(args: {
    open: Open
    outcome: EOperatorInputOutcome
    result: OperatorInputAnswerOutcome
  }): Promise<OperatorInputAnswerOutcome> {
    const { open } = args
    if (this.open.get(open.args.threadId) !== open || open.settling) {
      return { ok: false, reason: 'that request was already answered or cancelled' }
    }
    open.settling = true
    let result = args.result
    try {
      await this.append({
        threadId: open.args.threadId,
        drafts: [{
          type: 'operator-input-resolved', requestId: open.request.requestId, outcome: args.outcome,
          ...(result.ok ? { bytes: result.bytes } : {}),
        }],
      })
    } catch {
      result = { ok: false, reason: 'operator input settled but its outcome could not be recorded; do not resend this request' }
    }
    this.clear(open)
    open.resolve(result)
    return result
  }

  private clear(open: Open): void {
    if (this.open.get(open.args.threadId) !== open) return
    this.open.delete(open.args.threadId)
    open.removeAbort()
    this.publish({ threadId: open.args.threadId, request: null })
  }

  private append(args: { threadId: ThreadId; drafts: readonly EventDraft[] }): Promise<unknown> {
    return this.deps.log.append({ ...args, runId: this.deps.ids.nextRunId() })
  }

  private publish(args: { threadId: ThreadId; request: OperatorInputPending | null }): void {
    this.deps.channel()?.publisherFor({ threadId: args.threadId }).operatorInput({
      open: args.request,
      ...(this.deps.onListenerError === undefined ? {} : { onListenerError: this.deps.onListenerError }),
    })
  }
}
