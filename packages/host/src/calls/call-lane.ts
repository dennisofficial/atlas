import type { CallResult } from '@dltech/atlas-protocol'

import type { Answers } from './answers'
import type { CallLane } from './call-open'
import type { Pending } from './remote-calls-frames'
import type { ReadyReply } from './ready-gate'

export type CallLaneArgs = {
  pending: Map<string, Pending>
  answers: Answers
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

export const callLaneOf = (args: CallLaneArgs): CallLane => ({
  pending: args.pending,
  answers: args.answers,
  detached: () => args.detached(),
  gone: () => args.gone(),
  linkReady: () => args.linkReady(),
  bootId: () => args.bootId(),
  ready: (signal) => args.ready(signal),
  arrived: (frame) => args.arrived(frame),
  flushAcks: () => args.flushAcks(),
  flushCancels: (bootId) => args.flushCancels(bootId),
  logged: (fields) => args.logged(fields),
  helloReady: (hello) => args.helloReady(hello),
  listed: () => args.listed(),
  sendCancel: (call) => args.sendCancel(call),
  sendRun: (call) => args.sendRun(call),
  resizeReason: () => args.resizeReason(),
  settle: (call, result) => args.settle(call, result),
  schedulePing: () => args.schedulePing(),
})
