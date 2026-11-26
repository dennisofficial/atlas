import type { DaemonAnswer } from './errors'
import type { DaemonLink } from './link'
import type { FrameSink, Pending } from './remote-calls-frames'
import type { CallResult, DaemonFrame } from '@dltech/atlas-protocol'

export const frameSinkOf = (args: {
  pending: Map<string, Pending>
  link: DaemonLink
  settleAck(args: { key: string; found: boolean }): boolean
  settle(call: Pending, result: CallResult): void
  settleError(call: Pending, error: Error): void
  sendRun(call: Pending): void
  failAll(error: Error): void
  handleHelloReply(frame: {
    bootId: string
    version: string
    capabilities?: readonly string[] | undefined
  }): void
  answered(key: string, state: DaemonAnswer): void
  emitEvent(frame: Extract<DaemonFrame, { kind: 'event' }>): void
}): FrameSink => ({
  pending: args.pending,
  link: args.link,
  settleAck: (settled) => args.settleAck(settled),
  settle: (call, result) => args.settle(call, result),
  settleError: (call, error) => args.settleError(call, error),
  sendRun: (call) => args.sendRun(call),
  failAll: (error) => args.failAll(error),
  handleHelloReply: (frame) => args.handleHelloReply(frame),
  answered: (key, state) => args.answered(key, state),
  emitEvent: (frame) => args.emitEvent(frame),
})
