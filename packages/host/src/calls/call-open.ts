import type { CallOp, CallResult } from '@dltech/atlas-protocol'

import { attachRecordedCall, decideCall } from './call-decide'
import { abandonCall, attachCallSignal } from './call-signal'
import { callLostAcrossBoot, type DaemonAnswer } from './errors'
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
}

export type AnswerAsker = { ask(key: string): Promise<DaemonAnswer> }

export type CallLane = {
  readonly pending: Map<string, Pending>
  readonly answers: AnswerAsker
  detached(): boolean
  gone(): boolean
  linkReady(): boolean
  bootId(): string | undefined
  ready(signal?: AbortSignal | undefined): Promise<ReadyReply | undefined>
  arrived(frame: { bootId: string; version: string }): void
  flushAcks(): number
  flushCancels(bootId: string): void
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
  replayed?: boolean | undefined
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
    waiting: false,
    ...(request.attachOnly === true ? { attachOnly: true } : {}),
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
  call.dispatchBootId = args.dispatchedBootId
  if (request.attachOnly === true) {
    await attachRecordedCall({ lane, call })
    return outcome
  }
  if (
    needsDecision({ lane, call, dispatchedBootId: args.dispatchedBootId, replayed: args.replayed })
  ) {
    await decideCall({ lane, call })
    return outcome
  }
  const resize = lane.resizeReason()
  if (
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

const needsDecision = (args: {
  lane: CallLane
  call: Pending
  dispatchedBootId: string | undefined
  replayed: boolean | undefined
}): boolean =>
  callLostAcrossBoot({
    op: args.call.op.op,
    dispatchedBootId: args.dispatchedBootId,
    currentBootId: args.lane.bootId(),
  }) ||
  (args.replayed === true && args.dispatchedBootId === undefined)
