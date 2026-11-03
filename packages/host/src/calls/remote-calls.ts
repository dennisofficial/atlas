import { randomUUID } from 'node:crypto'

import type { LogPort } from '@dltech/atlas-observability'
import type { CallOp, CallResult } from '@dltech/atlas-protocol'

import { RemoteCallsState } from './remote-calls-state'
import type { DaemonConnector } from './socket'

export type CallTimers = {
  setTimeout(handler: () => void, ms: number): unknown
  clearTimeout(timer: unknown): void
  random(): number
}

export type RemoteCallsArgs = {
  sessionId: string
  token: string
  connector(): Promise<DaemonConnector>
  timers: CallTimers
  onFenced(): void
  log?: LogPort | undefined
}

export class RemoteCalls {
  private readonly state: RemoteCallsState

  constructor(args: RemoteCallsArgs) {
    this.state = new RemoteCallsState(args)
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

  close(): void {
    this.state.close()
  }

  invoke(args: {
    key: string
    op: CallOp
    signal?: AbortSignal | undefined
    onOutput?: ((bytes: Uint8Array) => void) | undefined
    dispatchedBootId?: string | undefined
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
