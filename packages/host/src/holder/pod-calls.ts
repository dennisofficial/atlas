import {
  ELiveOpFailure,
  LIVE_OP_TIMEOUT_MS,
  type CallOp,
  type CallResult,
} from '@dltech/atlas-protocol'

import { newKey, type EventFrame, type RemoteCloseReason } from '../calls/remote-calls'
import type { SessionRuntime } from './ports'

export type PodCallOutcome =
  | { state: 'ok'; result: CallResult }
  | { state: 'unavailable'; reason: ELiveOpFailure.Asleep | ELiveOpFailure.Absent }

const withTimeout = <T>(args: { work: Promise<T>; timeoutMs: number; op: string }): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${args.op} timed out after ${args.timeoutMs}ms`)),
      args.timeoutMs,
    )
    args.work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (failure: unknown) => {
        clearTimeout(timer)
        reject(failure)
      },
    )
  })

export class PodCalls {
  private readonly held: (sessionId: string) => SessionRuntime | undefined
  private readonly timeoutMs: number

  constructor(args: {
    held: (sessionId: string) => SessionRuntime | undefined
    timeoutMs?: number
  }) {
    this.held = args.held
    this.timeoutMs = args.timeoutMs ?? LIVE_OP_TIMEOUT_MS
  }

  async invoke(args: {
    sessionId: string
    op: CallOp
    signal?: AbortSignal | undefined
  }): Promise<PodCallOutcome> {
    const runtime = this.held(args.sessionId)
    if (runtime === undefined) return { state: 'unavailable', reason: ELiveOpFailure.Asleep }
    const result = await withTimeout({
      work: runtime.remoteCalls.invoke({
        key: newKey(),
        op: args.op,
        ...(args.signal === undefined ? {} : { signal: args.signal }),
      }),
      timeoutMs: this.timeoutMs,
      op: args.op.op,
    })
    return { state: 'ok', result }
  }

  events(args: {
    sessionId: string
    listener: (frame: EventFrame) => void
    onClose?: ((reason: RemoteCloseReason) => void) | undefined
  }): (() => void) | null {
    const runtime = this.held(args.sessionId)
    if (runtime === undefined) return null
    const offEvent = runtime.remoteCalls.onEvent(args.listener)
    const offClose =
      args.onClose === undefined ? () => {} : runtime.remoteCalls.onClose(args.onClose)
    return () => {
      offEvent()
      offClose()
    }
  }
}
