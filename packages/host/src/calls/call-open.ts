import type { CallOp, CallResult } from '@dltech/atlas-protocol'

import type { Answers } from './answers'
import { abandonCall, attachCallSignal } from './call-signal'
import { scopeDetachOnHandoff } from './call-scope'
import { actionForAnswer, callLostAcrossBoot, needsRun } from './errors'
import type { ReadyReply } from './ready-gate'
import { interruptedResult, type Pending, type Waiter } from './remote-calls-frames'
import { resizeInterruptedResult } from './restart-interrupt'

export type OpenCallArgs = {
  key: string
  op: CallOp
  signal?: AbortSignal | undefined
  onOutput?: ((bytes: Uint8Array) => void) | undefined
  dispatchedBootId?: string | undefined
  attachOnly?: boolean | undefined
  detachOnHandoff?: boolean | undefined
}

export type CallLane = {
  readonly pending: Map<string, Pending>
  readonly answers: Answers
  detached(): boolean
  gone(): boolean
  linkReady(): boolean
  bootId(): string | undefined
  ready(signal?: AbortSignal | undefined): Promise<ReadyReply | undefined>
  arrived(frame: {
    bootId: string
    version: string
    capabilities?: readonly string[] | undefined
  }): void
  flushAcks(): number
  logged(fields: { restart: boolean; flushedAcks: number; pending: number }): void
  helloReady(hello: { bootId: string; restart: boolean }): void
  listed(): Pending[]
  sendCancel(call: Pending): void
  sendRun(call: Pending): void
  resizeReason(): string | undefined
  settle(call: Pending, result: CallResult): void
  schedulePing(): void
}

export const openCall = async (args: {
  lane: CallLane
  request: OpenCallArgs
  dispatchedBootId: string | undefined
}): Promise<CallResult> => {
  const { lane, request } = args
  const waiter: Waiter = { settle: () => {}, onOutput: request.onOutput }
  const outcome = new Promise<CallResult>((resolve, reject) => {
    waiter.settle = resolve
    waiter.reject = reject
  })
  outcome.catch(() => undefined)
  const existing = lane.pending.get(request.key)
  if (existing !== undefined) {
    if (lane.detached()) return outcome
    existing.waiters.push(waiter)
    return outcome
  }
  const call: Pending = {
    key: request.key,
    op: request.op,
    waiters: [],
    controller: new AbortController(),
    delivered: 0,
    sent: false,
    armed: false,
    done: false,
    awaitingAnswer: false,
    detachOnHandoff: request.detachOnHandoff ?? scopeDetachOnHandoff(),
  }
  if (!lane.detached()) call.waiters.push(waiter)
  lane.pending.set(request.key, call)
  if (request.signal !== undefined) {
    attachCallSignal({
      call,
      signal: request.signal,
      isDetached: () => lane.detached(),
      isLinkReady: () => lane.linkReady(),
      sendCancel: () => lane.sendCancel(call),
      settleInterrupted: () => lane.settle(call, interruptedResult(call.op.op)),
    })
  }
  try {
    await lane.ready(call.controller.signal)
  } catch (error) {
    abandonCall({ call, pending: lane.pending, error: error as Error })
    throw error
  }
  if (call.done) return outcome
  if (request.attachOnly === true) {
    const answer = await lane.answers.ask(call.key)
    if (call.done || lane.gone()) return outcome
    if (answer !== 'running' && answer !== 'done') {
      lane.settle(call, interruptedResult(call.op.op))
      return outcome
    }
  }
  if (
    callLostAcrossBoot({
      op: call.op.op,
      dispatchedBootId: args.dispatchedBootId,
      currentBootId: lane.bootId(),
    })
  ) {
    const answer = await lane.answers.ask(call.key)
    if (call.done || lane.gone()) return outcome
    const action = actionForAnswer({
      op: call.op.op,
      dispatchedBootId: args.dispatchedBootId,
      currentBootId: lane.bootId(),
      answer,
    })
    if (!needsRun(action)) {
      lane.settle(call, interruptedResult(call.op.op))
      return outcome
    }
    if (action.type === 'rerun') call.delivered = 0
  }
  const resize = lane.resizeReason()
  if (
    request.attachOnly !== true &&
    resize !== undefined &&
    args.dispatchedBootId !== undefined &&
    args.dispatchedBootId === lane.bootId()
  ) {
    lane.settle(call, resizeInterruptedResult({ op: call.op.op, reason: resize }))
    return outcome
  }
  call.armed = true
  if (lane.linkReady()) lane.sendRun(call)
  return outcome
}
