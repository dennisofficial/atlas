import { ECallStatus, type CallResult } from '@dltech/atlas-protocol'

import { HolderDemand } from '../../holder-demand'
import { PodCalls } from '../../pod-calls'
import type { SessionRuntime } from '../../ports'
import { FakeBus, FakeClock } from '../../__tests__/rig-fakes'
import { PodRouter } from '../pod-router'
import { FakePodCallBus, fakePlaneOf } from './pod-route-fakes'

export const SESSION = 'ses_route'

export const STAT_OK: CallResult = {
  status: ECallStatus.Ok,
  op: 'stat',
  value: { size: 1, mode: 0, mtimeMs: 0, isFile: true, isDirectory: false },
}

export const runtimeOf = (args: { invoke: () => Promise<unknown> }): SessionRuntime =>
  ({
    remoteCalls: {
      invoke: () => args.invoke(),
      onEvent: () => () => undefined,
      onClose: () => () => undefined,
    },
  }) as unknown as SessionRuntime

export type RouterRigArgs = {
  plane: ReturnType<typeof fakePlaneOf>
  bus?: FakePodCallBus | undefined
  runtime?: SessionRuntime | undefined
  holds?: boolean | undefined
  draining?: boolean | undefined
  hostId?: number | undefined
  clock?: FakeClock | undefined
  holderWaitMs?: number | undefined
}

export const makeRouter = (
  args: RouterRigArgs,
): { router: PodRouter; demand: HolderDemand; clock: FakeClock } => {
  const clock = args.clock ?? new FakeClock()
  const demand = new HolderDemand({
    plane: args.plane.plane,
    bus: new FakeBus(),
    timers: clock,
    holds: () => args.holds === true,
    draining: () => args.draining === true,
    onReconcile: () => undefined,
    terminal: undefined,
    panel: undefined,
    log: undefined,
  })
  const router = new PodRouter({
    calls: new PodCalls({ held: () => args.runtime }),
    demand,
    plane: args.plane.plane,
    bus: args.bus,
    hostId: () => args.hostId ?? 1,
    runtimeOpen: () => args.runtime !== undefined,
    holds: () => args.holds === true,
    timers: clock,
    ...(args.holderWaitMs === undefined ? {} : { holderWaitMs: args.holderWaitMs }),
  })
  return { router, demand, clock }
}

export const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}
