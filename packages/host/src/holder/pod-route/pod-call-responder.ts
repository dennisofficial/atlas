import {
  ELiveOpFailure,
  EPodCallFailure,
  EPodCallKind,
  LIVE_OP_TIMEOUT_MS,
  type PodCallReplyOutcome,
  type PodCallRequest,
  type PodStreamFrame,
} from '@dltech/atlas-protocol'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import { FencedError } from '../../calls/errors'
import type { HolderDemand } from '../holder-demand'
import type { PodCalls } from '../pod-calls'
import type { PodCallBus } from '../pod-call-port'
import type { HostTimers } from '../ports'

export const POD_RESPONDER_READY_WAIT_MS = 5_000

const SEEN_REQUESTS_LIMIT = 1_024

type InvokeRequest = Extract<PodCallRequest, { kind: EPodCallKind.Invoke }>
type FollowRequest = Extract<PodCallRequest, { kind: EPodCallKind.Follow }>
type RenewRequest = Extract<PodCallRequest, { kind: EPodCallKind.Renew }>
type ReleaseRequest = Extract<PodCallRequest, { kind: EPodCallKind.Release }>

type ResponderStream = {
  arm(ttlMs: number): void
  drop(): void
}

export type PodCallResponderArgs = {
  calls: PodCalls
  demand: HolderDemand
  bus: PodCallBus
  hostId(): number | undefined
  runtimeOpen(sessionId: string): boolean
  holds(sessionId: string): boolean
  timers: HostTimers
  waitMs?: number | undefined
  log?: LogPort | undefined
}

class SeenRequests {
  private readonly timers: HostTimers
  private readonly seen = new Map<string, unknown>()

  constructor(timers: HostTimers) {
    this.timers = timers
  }

  firstTime(requestId: string): boolean {
    if (this.seen.has(requestId)) return false
    const timer = this.timers.setTimeout(() => this.seen.delete(requestId), LIVE_OP_TIMEOUT_MS * 2)
    this.seen.set(requestId, timer)
    if (this.seen.size > SEEN_REQUESTS_LIMIT) this.forgetOldest()
    return true
  }

  private forgetOldest(): void {
    const oldest = this.seen.keys().next()
    if (oldest.done === true) return
    this.timers.clearTimeout(this.seen.get(oldest.value))
    this.seen.delete(oldest.value)
  }
}

export class PodCallResponder {
  private readonly args: PodCallResponderArgs
  private readonly seen: SeenRequests
  private readonly streams = new Map<string, ResponderStream>()
  private unsubscribe: (() => void) | undefined
  private draining = false

  constructor(args: PodCallResponderArgs) {
    this.args = args
    this.seen = new SeenRequests(args.timers)
  }

  start(): void {
    if (this.unsubscribe !== undefined) return
    this.unsubscribe = this.args.bus.onRequest((request) => {
      if (request.targetHostId !== this.args.hostId()) return
      void this.handle(request).catch((error: unknown) => this.logFault(error))
    })
  }

  beginDrain(): void {
    this.draining = true
    this.closeStreams()
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.closeStreams()
  }

  private closeStreams(): void {
    for (const [streamId, stream] of [...this.streams]) {
      this.publish(streamId, { type: 'closed', reason: 'restarted' })
      stream.drop()
    }
  }

  private async handle(request: PodCallRequest): Promise<void> {
    if (!this.seen.firstTime(request.requestId)) return
    if (this.draining) return this.answerDraining(request)
    switch (request.kind) {
      case EPodCallKind.Invoke:
        return this.handleInvoke(request)
      case EPodCallKind.Follow:
        return this.handleFollow(request)
      case EPodCallKind.Renew:
        return this.handleRenew(request)
      case EPodCallKind.Release:
        return this.handleRelease(request)
    }
  }

  private async answerDraining(request: PodCallRequest): Promise<void> {
    await this.reply(
      request,
      request.kind === EPodCallKind.Release
        ? { state: 'open' }
        : { state: 'unavailable', reason: ELiveOpFailure.Asleep },
    )
  }

  private async handleInvoke(request: InvokeRequest): Promise<void> {
    if (!(await this.awaitRuntime(request.sessionId))) {
      await this.reply(request, { state: 'unavailable', reason: ELiveOpFailure.Asleep })
      return
    }
    this.args.demand.panel.hold({ sessionId: request.sessionId })
    try {
      const outcome = await this.args.calls.invoke({
        sessionId: request.sessionId,
        op: request.op,
      })
      await this.reply(
        request,
        outcome.state === 'ok'
          ? { state: 'ok', result: outcome.result }
          : { state: 'unavailable', reason: outcome.reason },
      )
    } catch (error) {
      await this.reply(request, failureOf(error))
    }
  }

  private async handleFollow(request: FollowRequest): Promise<void> {
    if (!(await this.awaitRuntime(request.sessionId))) {
      await this.reply(request, { state: 'unavailable', reason: ELiveOpFailure.Asleep })
      return
    }
    this.args.demand.panel.hold({ sessionId: request.sessionId })
    const release = this.args.demand.terminal.hold(request.sessionId)
    let ttl: unknown
    let offEvents: (() => void) | null = null
    const drop = (): void => {
      if (!this.streams.delete(request.streamId)) return
      this.args.timers.clearTimeout(ttl)
      offEvents?.()
      release()
    }
    const arm = (ttlMs: number): void => {
      this.args.timers.clearTimeout(ttl)
      ttl = this.args.timers.setTimeout(() => drop(), ttlMs)
    }
    offEvents = this.args.calls.events({
      sessionId: request.sessionId,
      listener: (frame) => this.publish(request.streamId, { type: 'event', frame }),
      onClose: (reason) => {
        this.publish(request.streamId, { type: 'closed', reason })
        drop()
      },
    })
    if (offEvents === null) {
      release()
      await this.reply(request, { state: 'unavailable', reason: ELiveOpFailure.Asleep })
      return
    }
    this.streams.set(request.streamId, { arm, drop })
    arm(request.ttlMs)
    await this.reply(request, { state: 'open' })
  }

  private async handleRenew(request: RenewRequest): Promise<void> {
    const stream = this.streams.get(request.streamId)
    if (stream === undefined) {
      await this.reply(request, { state: 'unavailable', reason: ELiveOpFailure.Absent })
      return
    }
    stream.arm(request.ttlMs)
    await this.reply(request, { state: 'open' })
  }

  private async handleRelease(request: ReleaseRequest): Promise<void> {
    this.streams.get(request.streamId)?.drop()
    await this.reply(request, { state: 'open' })
  }

  private async awaitRuntime(sessionId: string): Promise<boolean> {
    if (this.args.runtimeOpen(sessionId)) return true
    if (!this.args.holds(sessionId)) return false
    const wait = this.args.demand.waitForLocal({
      sessionId,
      timeoutMs: this.args.waitMs ?? POD_RESPONDER_READY_WAIT_MS,
    })
    const held = await wait.done
    return held && this.args.runtimeOpen(sessionId)
  }

  private async reply(request: PodCallRequest, outcome: PodCallReplyOutcome): Promise<void> {
    await this.args.bus.reply({
      replyTo: request.replyTo,
      reply: { requestId: request.requestId, outcome },
    })
  }

  private publish(streamId: string, frame: PodStreamFrame): void {
    void this.args.bus
      .publishFrame({ streamId, frame })
      .catch((error: unknown) => this.logFault(error))
  }

  private logFault(error: unknown): void {
    this.args.log?.warn({
      source: 'holder.pod-call',
      message: 'serving a pod call for another host failed',
      ...logFieldsOf({ error }),
    })
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const failureOf = (error: unknown): PodCallReplyOutcome =>
  error instanceof FencedError
    ? { state: 'failed', message: error.message, reason: EPodCallFailure.Fenced }
    : { state: 'failed', message: messageOf(error) }
