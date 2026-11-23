import type { ControlPlane } from '@dltech/atlas-control'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import type { HolderDemand } from '../holder-demand'
import type { PodCalls } from '../pod-calls'
import type { PodCallBus } from '../pod-call-port'
import type { HostTimers } from '../ports'
import { PodCallResponder } from './pod-call-responder'
import { PodRouter } from './pod-router'

export type HolderPodsArgs = {
  calls: PodCalls
  demand: HolderDemand
  plane: ControlPlane
  bus: PodCallBus | undefined
  hostId(): number | undefined
  runtimeOpen(sessionId: string): boolean
  holds(sessionId: string): boolean
  timers: HostTimers
  log: LogPort | undefined
}

export class HolderPods {
  readonly router: PodRouter
  private readonly args: HolderPodsArgs
  private readonly responder: PodCallResponder | undefined

  constructor(args: HolderPodsArgs) {
    this.args = args
    this.router = new PodRouter({
      calls: args.calls,
      demand: args.demand,
      plane: args.plane,
      bus: args.bus,
      hostId: args.hostId,
      runtimeOpen: args.runtimeOpen,
      holds: args.holds,
      timers: args.timers,
    })
    this.responder =
      args.bus === undefined
        ? undefined
        : new PodCallResponder({
            calls: args.calls,
            demand: args.demand,
            bus: args.bus,
            hostId: args.hostId,
            runtimeOpen: args.runtimeOpen,
            holds: args.holds,
            timers: args.timers,
            log: args.log,
          })
  }

  start(): void {
    this.responder?.start()
  }

  beginDrain(): void {
    this.responder?.beginDrain()
  }

  stop(): void {
    this.responder?.stop()
  }

  ready(sessionId: string): void {
    this.args.demand.notifyHeld(sessionId)
    const bus = this.args.bus
    const hostId = this.args.hostId()
    if (bus === undefined || hostId === undefined) return
    void bus.ready({ sessionId, hostId }).catch((error: unknown) => {
      this.args.log?.warn({
        source: 'holder.pod-call',
        message: 'publishing pod ready failed',
        ...logFieldsOf({ error }),
      })
    })
  }
}
