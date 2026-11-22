import { randomUUID } from 'node:crypto'

import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import type { CallOp, CallResult, DaemonFrame } from '@dltech/atlas-protocol'

import { RemoteCallsState } from './remote-calls-state'
import type { DaemonConnector } from './socket'

export type CallTimers = {
  setTimeout(handler: () => void, ms: number): unknown
  clearTimeout(timer: unknown): void
  random(): number
}

export type EventFrame = Extract<DaemonFrame, { kind: 'event' }>

export type RemoteCloseReason = 'asleep' | 'detached'

export type RemoteHello = { bootId: string; restart: boolean }

export type RemoteCallsArgs = {
  sessionId: string
  token: string | (() => string)
  connector(): Promise<DaemonConnector>
  started?: Promise<unknown> | undefined
  timers: CallTimers
  onFenced(): void
  log?: LogPort | undefined
  pingMs?: number | undefined
  handshakeMs?: number | undefined
  readyTimeoutMs?: number | undefined
  onEvent?: ((frame: EventFrame) => void) | undefined
  onReady?: ((hello: RemoteHello) => void) | undefined
}

export class RemoteCalls {
  private readonly state: RemoteCallsState
  private readonly eventListeners = new Set<(frame: EventFrame) => void>()
  private readonly closeListeners = new Set<(reason: RemoteCloseReason) => void>()
  private readonly readyListeners = new Set<(hello: RemoteHello) => void>()
  private readonly log: LogPort | undefined

  constructor(args: RemoteCallsArgs) {
    this.log = args.log
    this.state = new RemoteCallsState({
      ...args,
      onEvent: (frame) => this.emitEvent(frame),
      onReady: (hello) => this.emitReady(hello),
    })
  }

  onEvent(listener: (frame: EventFrame) => void): () => void {
    this.eventListeners.add(listener)
    return () => {
      this.eventListeners.delete(listener)
    }
  }

  onReady(listener: (hello: RemoteHello) => void): () => void {
    this.readyListeners.add(listener)
    return () => {
      this.readyListeners.delete(listener)
    }
  }

  onClose(listener: (reason: RemoteCloseReason) => void): () => void {
    this.closeListeners.add(listener)
    return () => {
      this.closeListeners.delete(listener)
    }
  }

  private emitReady(hello: RemoteHello): void {
    for (const listener of [...this.readyListeners]) {
      try {
        listener(hello)
      } catch (error) {
        this.log?.error({
          source: 'remote-calls',
          message: 'ready listener threw',
          ...logFieldsOf({ error }),
        })
      }
    }
  }

  private emitEvent(frame: EventFrame): void {
    for (const listener of [...this.eventListeners]) {
      try {
        listener(frame)
      } catch (error) {
        this.log?.error({
          source: 'remote-calls',
          message: 'event listener threw',
          ...logFieldsOf({ error }),
        })
      }
    }
  }

  open(args: { epoch: number }): void {
    this.state.open(args)
  }

  ready(): Promise<{ bootId: string; version: string }> {
    return this.state.ready()
  }

  bootId(): string | undefined {
    return this.state.bootId()
  }

  handoff(): void {
    this.state.handoff()
  }

  close(reason: RemoteCloseReason = 'detached'): void {
    const listeners = [...this.closeListeners]
    this.closeListeners.clear()
    this.eventListeners.clear()
    this.readyListeners.clear()
    this.state.close()
    for (const listener of listeners) {
      try {
        listener(reason)
      } catch (error) {
        this.log?.error({
          source: 'remote-calls',
          message: 'close listener threw',
          ...logFieldsOf({ error }),
        })
      }
    }
  }

  invoke(args: {
    key: string
    op: CallOp
    signal?: AbortSignal | undefined
    onOutput?: ((bytes: Uint8Array) => void) | undefined
    dispatchedBootId?: string | undefined
    attachOnly?: boolean | undefined
  }): Promise<CallResult> {
    return this.state.invoke(args)
  }

  ack(args: { key: string }): Promise<void> {
    return this.state.ack(args)
  }

  ackScope(args: { scopeKey: string; count?: number | undefined }): Promise<void> {
    return this.state.ackScope(args)
  }
}

export const systemTimers: CallTimers = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (timer) => clearTimeout(timer as Parameters<typeof clearTimeout>[0]),
  random: () => Math.random(),
}

export const newKey = (): string => `host-${randomUUID()}`
