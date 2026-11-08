import { ECallFailure, ECallStatus, EExecOutcome } from '@dltech/atlas-protocol'
import type { DaemonFrame, CallOp, CallResult } from '@dltech/atlas-protocol'

import { OpMismatchError, interruptedMessage, type DaemonAnswer } from './errors'
import type { DaemonLink } from './link'

export type Waiter = {
  settle(result: CallResult): void
  reject?: ((error: Error) => void) | undefined
  onOutput?: ((bytes: Uint8Array) => void) | undefined
  detach?: (() => void) | undefined
}

export type Pending = {
  key: string
  op: CallOp
  waiters: Waiter[]
  controller: AbortController
  delivered: number
  sent: boolean
  done: boolean
  awaitingAnswer: boolean
  detach?: (() => void) | undefined
}

export const interruptedResult = (op: string): CallResult =>
  failedResult({ op, code: ECallFailure.Interrupted, message: interruptedMessage(op) })

export const rejectPending = (args: {
  pending: Map<string, Pending>
  pendingAcks: Map<string, { key: string; resolve(found: boolean): void }>
  error: Error
}): void => {
  for (const call of [...args.pending.values()]) {
    if (call.done) continue
    call.done = true
    args.pending.delete(call.key)
    call.detach?.()
    for (const waiter of call.waiters) waiter.reject?.(args.error)
  }
  for (const ack of [...args.pendingAcks.values()]) ack.resolve(false)
  args.pendingAcks.clear()
}

export const failedResult = (args: {
  op: string
  code: ECallFailure
  message: string
}): CallResult => ({
  status: ECallStatus.Failed,
  op: args.op,
  error: { code: args.code, message: args.message },
})

export const handedOffResult = (call: Pending): CallResult => {
  if (call.op.op !== 'exec') {
    return failedResult({
      op: call.op.op,
      code: ECallFailure.Internal,
      message: interruptedMessage(call.op.op),
    })
  }
  return {
    status: ECallStatus.Ok,
    op: 'exec',
    value: {
      exitCode: null,
      signal: 'SIGTERM',
      outcome: EExecOutcome.TimedOut,
      outputBytes: call.delivered,
    },
  }
}

export const cancelledResult = (call: Pending): CallResult => {
  if (call.op.op !== 'exec') {
    return failedResult({ op: call.op.op, code: ECallFailure.Cancelled, message: 'cancelled' })
  }
  return {
    status: ECallStatus.Ok,
    op: 'exec',
    value: {
      exitCode: null,
      signal: 'SIGTERM',
      outcome: EExecOutcome.Cancelled,
      outputBytes: call.delivered,
    },
  }
}

export type FrameSink = {
  pending: Map<string, Pending>
  pendingAcks: Map<string, { key: string; resolve(found: boolean): void }>
  link: DaemonLink
  settle(call: Pending, result: CallResult): void
  settleError(call: Pending, error: Error): void
  sendRun(call: Pending): void
  failAll(error: Error): void
  handleHelloReply(frame: { bootId: string; version: string }): void
  answered(key: string, state: DaemonAnswer): void
  emitEvent(frame: Extract<DaemonFrame, { kind: 'event' }>): void
}

export const handleDaemonFrame = (state: FrameSink, frame: DaemonFrame): void => {
  if (frame.kind === 'hello-reply') {
    state.handleHelloReply(frame)
    return
  }
  if (frame.kind === 'answered') {
    state.answered(frame.key, frame.state)
    return
  }
  if (frame.kind === 'output') {
    const call = state.pending.get(frame.key)
    if (call === undefined || frame.offset < call.delivered) return
    const bytes = Buffer.from(frame.bytes, 'base64')
    call.delivered = frame.offset + bytes.length
    const view = new Uint8Array(bytes)
    for (const waiter of call.waiters) waiter.onOutput?.(view)
    return
  }
  if (frame.kind === 'result') {
    handleResult(state, frame)
    return
  }
  if (frame.kind === 'event') {
    state.emitEvent(frame)
    return
  }
  if (frame.kind === 'run-reply' || frame.kind === 'health') return
  if (frame.kind === 'pong') return
  if (frame.kind === 'acked') {
    state.pendingAcks.get(frame.key)?.resolve(true)
    state.pendingAcks.delete(frame.key)
    return
  }
  handleErrorFrame(state, frame)
}

const handleResult = (state: FrameSink, frame: { key: string; result: CallResult }): void => {
  const call = state.pending.get(frame.key)
  if (call === undefined) return
  if (frame.result.op !== call.op.op) {
    state.failAll(
      new OpMismatchError({ key: frame.key, expected: call.op.op, actual: frame.result.op }),
    )
    return
  }
  state.settle(call, frame.result)
}

const handleErrorFrame = (
  state: FrameSink,
  frame: { key?: string | undefined; errorKind: string; message: string },
): void => {
  if (frame.key !== undefined) state.answered(frame.key, 'unavailable')
  const pendingAck = frame.key === undefined ? undefined : state.pendingAcks.get(frame.key)
  if (pendingAck !== undefined && frame.key !== undefined) {
    pendingAck.resolve(false)
    state.pendingAcks.delete(frame.key)
    return
  }
  if (frame.errorKind === 'stale-epoch') return
  if (frame.key !== undefined && frame.errorKind === 'unknown-key') {
    const call = state.pending.get(frame.key)
    if (call === undefined || !call.sent) return
    if (call.controller.signal.aborted) {
      state.settle(call, cancelledResult(call))
      return
    }
    state.sendRun(call)
    return
  }
  const call = frame.key === undefined ? undefined : state.pending.get(frame.key)
  if (call !== undefined) {
    state.settleError(call, new Error(`${frame.errorKind}: ${frame.message}`))
  }
}
