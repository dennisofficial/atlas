import {
  ECallStatus,
  EPodCallKind,
  type CallResult,
  type PodCallRequest,
} from '@dltech/atlas-protocol'

import { HolderDemand } from '../../holder-demand'
import { PodCalls } from '../../pod-calls'
import type { SessionRuntime } from '../../ports'
import { FakeBus, FakeClock } from '../../__tests__/rig-fakes'
import { PodCallResponder } from '../pod-call-responder'
import { FakePodCallBus, fakePlaneOf } from './pod-route-fakes'

export const SESSION = 'ses_respond'
export const HOST = 4
export const STREAM = 'stream-1'
export const TTL = 30_000

export const runtimeOf = (args: { invoke: () => Promise<unknown> }): SessionRuntime =>
  ({
    remoteCalls: {
      invoke: () => args.invoke(),
      onEvent: () => () => undefined,
      onClose: () => () => undefined,
    },
  }) as unknown as SessionRuntime

export const STAT_OK: CallResult = {
  status: ECallStatus.Ok,
  op: 'stat',
  value: { size: 1, mode: 0, mtimeMs: 0, isFile: true, isDirectory: false },
}

const address = {
  requestId: 'req-1',
  replyTo: 'requester-1',
  sessionId: SESSION,
  targetHostId: HOST,
}

export const invokeRequest = (): PodCallRequest => ({
  kind: EPodCallKind.Invoke,
  ...address,
  op: { op: 'stat', path: 'a.ts' },
})

export const followRequest = (): PodCallRequest => ({
  kind: EPodCallKind.Follow,
  ...address,
  streamId: STREAM,
  ttlMs: TTL,
})

export const renewRequest = (): PodCallRequest => ({
  kind: EPodCallKind.Renew,
  ...address,
  streamId: STREAM,
  ttlMs: TTL,
})

export const releaseRequest = (): PodCallRequest => ({
  kind: EPodCallKind.Release,
  ...address,
  streamId: STREAM,
})

export const makeResponder = (args: {
  runtime?: SessionRuntime | undefined
  holds?: boolean | undefined
  hostId?: number | undefined
  clock?: FakeClock | undefined
}) => {
  const clock = args.clock ?? new FakeClock()
  const plane = fakePlaneOf({ holderHostId: null, wantsHolder: true })
  const bus = new FakePodCallBus()
  const state = { runtime: args.runtime }
  const demand = new HolderDemand({
    plane: plane.plane,
    bus: new FakeBus(),
    timers: clock,
    holds: () => args.holds === true,
    draining: () => false,
    onReconcile: () => undefined,
    terminal: undefined,
    panel: undefined,
    log: undefined,
  })
  const responder = new PodCallResponder({
    calls: new PodCalls({ held: () => state.runtime }),
    demand,
    bus,
    hostId: () => args.hostId ?? HOST,
    runtimeOpen: () => state.runtime !== undefined,
    holds: () => args.holds === true,
    timers: clock,
  })
  responder.start()
  return { responder, bus, clock, demand, state }
}

export const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}
