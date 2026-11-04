import { ECallFailure, ECallStatus, EExecOutcome } from '@dltech/atlas-protocol'
import type { DaemonFrame, CallOp, CallResult } from '@dltech/atlas-protocol'

import { OpMismatchError, actionForLostCall, interruptedMessage } from './errors'
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
  detach?: (() => void) | undefined
}

export const interruptedResult = (op: string): CallResult =>
  failedResult({ op, code: ECallFailure.Internal, message: interruptedMessage(op) })

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
  recoverAcrossRestart(previousBootId: string): void
}

export const handleDaemonFrame = (state: FrameSink, frame: DaemonFrame): void => {
  if (frame.kind === 'hello-reply') {
    state.handleHelloReply(frame)
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
  if (frame.kind === 'run-reply' || frame.kind === 'event' || frame.kind === 'health') return
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
  if (frame.errorKind === 'stale-epoch') return
  if (frame.key !== undefined && frame.errorKind === 'unknown-key') {
    const ack = state.pendingAcks.get(frame.key)
    if (ack !== undefined) {
      ack.resolve(false)
      state.pendingAcks.delete(frame.key)
      return
    }
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

export const recoverRestartedCalls = (args: {
  state: FrameSink
  previousBootId: string
  currentBootId: string
}): void => {
  const { state } = args
  for (const call of [...state.pending.values()]) {
    if (call.done) continue
    const action = actionForLostCall({
      op: call.op.op,
      dispatchedBootId: args.previousBootId,
      currentBootId: args.currentBootId,
    })
    if (action.rerun) {
      call.delivered = 0
      continue
    }
    state.settle(
      call,
      failedResult({
        op: call.op.op,
        code: ECallFailure.Internal,
        message: interruptedMessage(call.op.op),
      }),
    )
  }
}
