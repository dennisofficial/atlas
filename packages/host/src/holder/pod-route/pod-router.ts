import { randomUUID } from 'node:crypto'

import { EPodReachStep, podReachStepOf } from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import {
  ELiveOpFailure,
  EPodCallKind,
  LIVE_OP_TIMEOUT_MS,
  type CallOp,
  type PodCallReplyOutcome,
} from '@dltech/atlas-protocol'

import type { EventFrame } from '../../calls/remote-calls'
import type { HolderDemand } from '../holder-demand'
import type { PodCalls, PodCallOutcome } from '../pod-calls'
import type { PodCallBus } from '../pod-call-port'
import type { HostTimers } from '../ports'
import { followRemotePod } from './pod-follow'
import { armPodReady, awaitPodReady } from './pod-ready-wait'
import { EPodReach, type PodFollowClose, type PodReach } from './pod-reach'

export const POD_HOLDER_WAIT_MS = 10_000

export type PodRouterArgs = {
  calls: PodCalls
  demand: HolderDemand
  plane: ControlPlane
  bus: PodCallBus | undefined
  hostId(): number | undefined
  runtimeOpen(sessionId: string): boolean
  holds(sessionId: string): boolean
  timers: HostTimers
  holderWaitMs?: number | undefined
  callTimeoutMs?: number | undefined
}

export class PodRouter {
  private readonly args: PodRouterArgs

  constructor(args: PodRouterArgs) {
    this.args = args
  }

  async reach(args: { sessionId: string; signal?: AbortSignal | undefined }): Promise<PodReach> {
    const current = await this.args.plane.currentLease({ sessionId: args.sessionId })
    const step = podReachStepOf({
      runtimeOpen: this.args.runtimeOpen(args.sessionId),
      holdsLocally: this.args.holds(args.sessionId),
      selfHostId: this.args.hostId(),
      holderHostId: current.lease.holderHostId,
      holderLive: current.live,
      wantsHolder: current.lease.wantsHolder,
    })
    switch (step) {
      case EPodReachStep.Local:
        return { kind: EPodReach.Local }
      case EPodReachStep.AwaitLocal:
        return this.awaitReady(args)
      case EPodReachStep.Forward:
        return current.lease.holderHostId === null
          ? { kind: EPodReach.Unreachable }
          : { kind: EPodReach.Remote, hostId: current.lease.holderHostId }
      case EPodReachStep.Wake:
      case EPodReachStep.Revoke:
        return this.requestThenAwait(args)
    }
  }

  async invoke(args: {
    sessionId: string
    op: CallOp
    signal?: AbortSignal | undefined
    waitForHolder?: boolean | undefined
  }): Promise<PodCallOutcome> {
    if (args.waitForHolder !== true) return this.invokeLocally(args)
    const reach = await this.reach(args)
    if (reach.kind === EPodReach.Local) return this.invokeLocally(args)
    if (reach.kind === EPodReach.Unreachable) {
      return { state: 'unavailable', reason: ELiveOpFailure.Asleep }
    }
    return this.forwardInvoke({ ...args, hostId: reach.hostId })
  }

  async follow(args: {
    sessionId: string
    listener: (frame: EventFrame) => void
    onClose?: ((reason: PodFollowClose) => void) | undefined
    signal?: AbortSignal | undefined
  }): Promise<(() => void) | null> {
    const reach = await this.reach({ sessionId: args.sessionId, signal: args.signal })
    if (reach.kind === EPodReach.Unreachable) return null
    if (reach.kind === EPodReach.Local) {
      return this.args.calls.events({
        sessionId: args.sessionId,
        listener: args.listener,
        ...(args.onClose === undefined ? {} : { onClose: args.onClose }),
      })
    }
    const bus = this.args.bus
    if (bus === undefined) return null
    return followRemotePod({
      bus,
      timers: this.args.timers,
      sessionId: args.sessionId,
      hostId: reach.hostId,
      listener: args.listener,
      ...(args.onClose === undefined ? {} : { onClose: args.onClose }),
      ...(args.signal === undefined ? {} : { signal: args.signal }),
      timeoutMs: this.callTimeoutMs(),
    })
  }

  private awaitReady(args: {
    sessionId: string
    signal?: AbortSignal | undefined
  }): Promise<PodReach> {
    return awaitPodReady({
      sessionId: args.sessionId,
      selfHostId: this.args.hostId(),
      demand: this.args.demand,
      bus: this.args.bus,
      timeoutMs: this.args.holderWaitMs ?? POD_HOLDER_WAIT_MS,
      ...(args.signal === undefined ? {} : { signal: args.signal }),
    })
  }

  private async requestThenAwait(args: {
    sessionId: string
    signal?: AbortSignal | undefined
  }): Promise<PodReach> {
    const ready = armPodReady({
      sessionId: args.sessionId,
      selfHostId: this.args.hostId(),
      demand: this.args.demand,
      bus: this.args.bus,
      timeoutMs: this.args.holderWaitMs ?? POD_HOLDER_WAIT_MS,
      ...(args.signal === undefined ? {} : { signal: args.signal }),
    })
    const requested = await this.args.demand.requestHolder(args.sessionId).catch(() => false)
    const decided = await this.reachAfterRequest({ sessionId: args.sessionId, requested })
    if (decided === undefined) return ready.done
    ready.settle(decided)
    return decided
  }

  private async reachAfterRequest(args: {
    sessionId: string
    requested: boolean
  }): Promise<PodReach | undefined> {
    const current = await this.args.plane.currentLease({ sessionId: args.sessionId })
    const step = podReachStepOf({
      runtimeOpen: this.args.runtimeOpen(args.sessionId),
      holdsLocally: this.args.holds(args.sessionId),
      selfHostId: this.args.hostId(),
      holderHostId: current.lease.holderHostId,
      holderLive: current.live,
      wantsHolder: current.lease.wantsHolder,
    })
    if (step === EPodReachStep.Local) return { kind: EPodReach.Local }
    if (step === EPodReachStep.Forward && current.lease.holderHostId !== null) {
      return { kind: EPodReach.Remote, hostId: current.lease.holderHostId }
    }
    return args.requested ? undefined : { kind: EPodReach.Unreachable }
  }

  private async forwardInvoke(args: {
    sessionId: string
    op: CallOp
    signal?: AbortSignal | undefined
    hostId: number
  }): Promise<PodCallOutcome> {
    const bus = this.args.bus
    if (bus === undefined) return { state: 'unavailable', reason: ELiveOpFailure.Asleep }
    const first = await this.forwardOnce({ ...args, bus }).catch((error: unknown) => {
      if (!isTimeoutFailure(error)) throw error
      return undefined
    })
    if (first !== undefined && first.state !== 'unavailable') return first
    const again = await this.reach({ sessionId: args.sessionId, signal: args.signal })
    if (again.kind === EPodReach.Local) return this.invokeLocally(args)
    if (again.kind === EPodReach.Unreachable) {
      return first ?? { state: 'unavailable', reason: ELiveOpFailure.Asleep }
    }
    return this.forwardOnce({ ...args, hostId: again.hostId, bus })
  }

  private async forwardOnce(args: {
    bus: PodCallBus
    sessionId: string
    op: CallOp
    hostId: number
    signal?: AbortSignal | undefined
  }): Promise<PodCallOutcome> {
    const reply = await args.bus.request({
      request: {
        kind: EPodCallKind.Invoke,
        requestId: randomUUID(),
        replyTo: args.bus.requesterId,
        sessionId: args.sessionId,
        targetHostId: args.hostId,
        op: args.op,
      },
      timeoutMs: this.callTimeoutMs(),
      ...(args.signal === undefined ? {} : { signal: args.signal }),
    })
    return outcomeOf(reply)
  }

  private invokeLocally(args: {
    sessionId: string
    op: CallOp
    signal?: AbortSignal | undefined
  }): Promise<PodCallOutcome> {
    return this.args.calls.invoke({
      sessionId: args.sessionId,
      op: args.op,
      ...(args.signal === undefined ? {} : { signal: args.signal }),
    })
  }

  private callTimeoutMs(): number {
    return this.args.callTimeoutMs ?? LIVE_OP_TIMEOUT_MS
  }
}

const outcomeOf = (reply: PodCallReplyOutcome): PodCallOutcome => {
  switch (reply.state) {
    case 'ok':
      return { state: 'ok', result: reply.result }
    case 'unavailable':
      return { state: 'unavailable', reason: reply.reason }
    case 'failed':
      throw new Error(reply.message)
    case 'open':
      throw new Error('a pod call answered an invoke with a stream reply')
  }
}

const isTimeoutFailure = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('timed out')
