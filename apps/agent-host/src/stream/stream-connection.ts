import { randomUUID } from 'node:crypto'

import type { ServerWebSocket } from 'bun'

import type { HostTimers } from '@dltech/atlas-host'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import {
  EStreamClose,
  EStreamErrorCode,
  STREAM_HELLO_TIMEOUT_MS,
  STREAM_MAX_CLIENT_FRAME_BYTES,
  STREAM_PROTOCOL_VERSION,
  type StreamClientMessage,
  type StreamServerMessage,
} from '@dltech/atlas-protocol'

import { decodeFrame, frameBytes } from './decode-frame'
import { readyFrameOf } from './ready-frame'
import type { StreamAuthPort } from './stream-auth'
import {
  EStreamServerClose,
  STREAM_AUTH_LOOKUP_TIMEOUT_MS,
  STREAM_AUTH_RECHECK_MS,
  STREAM_HEARTBEAT_MS,
} from './stream-limits'
import type { SubscriptionPort, SubscriptionSession } from './subscription-port'

enum EPhase {
  AwaitingHello,
  Authenticating,
  Ready,
  Closed,
}

export type StreamSocketData = { connection: StreamConnection | undefined }

export type UserSlots = {
  acquire(userId: string): boolean
  release(userId: string): void
}

export type StreamConnectionDeps = {
  auth: StreamAuthPort
  subscriptions: SubscriptionPort
  timers: HostTimers
  users: UserSlots
  eventTypes: readonly string[] | undefined
  log: LogPort | undefined
  onClosed(connection: StreamConnection): void
}

export class StreamConnection {
  readonly id = randomUUID()
  private phase = EPhase.AwaitingHello
  private bearer = ''
  private userId: string | undefined
  private session: SubscriptionSession | undefined
  private expiresAt = 0
  private helloTimer: unknown
  private recheckTimer: unknown
  private heartbeatTimer: unknown

  constructor(
    private readonly socket: ServerWebSocket<StreamSocketData>,
    private readonly deps: StreamConnectionDeps,
  ) {
    this.helloTimer = deps.timers.setTimeout(
      () => this.close(EStreamClose.Unauthenticated),
      STREAM_HELLO_TIMEOUT_MS,
    )
  }

  handleMessage(raw: string | Buffer): void {
    if (this.phase === EPhase.Closed || this.phase === EPhase.Authenticating) return
    if (frameBytes(raw) > STREAM_MAX_CLIENT_FRAME_BYTES) {
      this.send({ type: 'error', code: EStreamErrorCode.BadFrame })
      this.close(EStreamServerClose.MessageTooBig)
      return
    }
    const decoded = decodeFrame(raw)
    if (this.phase === EPhase.AwaitingHello) {
      if (decoded.ok && decoded.message.type === 'hello') {
        this.clearHelloTimer()
        this.helloTimer = this.deps.timers.setTimeout(
          () => this.close(EStreamClose.Unauthenticated),
          STREAM_AUTH_LOOKUP_TIMEOUT_MS,
        )
        this.phase = EPhase.Authenticating
        this.bearer = decoded.message.token
        this.authenticate(decoded.message.v)
        return
      }
      this.close(EStreamClose.Unauthenticated)
      return
    }
    if (!decoded.ok) {
      if (!('unknown' in decoded)) this.send({ type: 'error', code: EStreamErrorCode.BadFrame })
      return
    }
    this.route(decoded.message)
  }

  handleDrain(): void {
    this.session?.drain()
  }

  handleClose(): void {
    this.clearTimers()
    this.phase = EPhase.Closed
    if (this.userId !== undefined) this.deps.users.release(this.userId)
    this.userId = undefined
    this.session?.close()
    this.session = undefined
    this.deps.onClosed(this)
  }

  goAway(reconnectAfterMs: number): void {
    this.send({ type: 'going-away', reconnectAfterMs })
    this.close(EStreamClose.GoingAway)
  }

  close(code: number): void {
    if (this.phase === EPhase.Closed) return
    this.send({ type: 'closing', code })
    this.clearTimers()
    this.phase = EPhase.Closed
    this.socket.close(code)
  }

  private route(message: StreamClientMessage): void {
    if (message.type === 'ping') {
      this.send({ type: 'pong' })
      return
    }
    if (message.type === 'hello') return
    const session = this.session
    if (session === undefined) return
    Promise.resolve(session.handle(message)).catch((error: unknown) => {
      this.deps.log?.error({
        source: 'stream',
        message: 'subscription handler failed',
        ...logFieldsOf({ error }),
      })
      this.send({ type: 'error', id: message.id, code: EStreamErrorCode.Internal })
    })
  }

  private authenticate(helloVersion: number): void {
    this.deps.auth.resolve(this.bearer).then(
      (principal) => {
        if (this.phase !== EPhase.Authenticating) return
        if (principal === undefined) {
          this.close(EStreamClose.Unauthenticated)
          return
        }
        if (!this.deps.users.acquire(principal.userId)) {
          this.send({ type: 'error', code: EStreamErrorCode.ForbiddenLimit })
          this.close(EStreamServerClose.PolicyViolation)
          return
        }
        this.clearHelloTimer()
        this.userId = principal.userId
        this.expiresAt = principal.expiresAt
        this.phase = EPhase.Ready
        const version = Math.min(helloVersion, STREAM_PROTOCOL_VERSION)
        this.session = this.deps.subscriptions.open({
          userId: principal.userId,
          version,
          send: (m) => this.send(m),
          bufferedAmount: () => this.socket.getBufferedAmount(),
          close: (code) => this.close(code),
        })
        this.send(
          readyFrameOf({
            version,
            connectionId: this.id,
            eventTypes: this.deps.eventTypes,
          }),
        )
        this.armRecheck()
        this.armHeartbeat()
      },
      (error: unknown) => {
        this.deps.log?.error({
          source: 'stream',
          message: 'auth lookup failed',
          ...logFieldsOf({ error }),
        })
        this.close(EStreamServerClose.InternalError)
      },
    )
  }

  private armRecheck(): void {
    const untilExpiry = this.expiresAt - this.deps.timers.now()
    this.recheckTimer = this.deps.timers.setTimeout(
      () => {
        this.recheckTimer = undefined
        this.recheck()
      },
      Math.max(0, Math.min(STREAM_AUTH_RECHECK_MS, untilExpiry)),
    )
  }

  private armHeartbeat(): void {
    this.heartbeatTimer = this.deps.timers.setTimeout(() => {
      this.heartbeatTimer = undefined
      if (this.phase !== EPhase.Ready) return
      this.send({ type: 'pong' })
      this.armHeartbeat()
    }, STREAM_HEARTBEAT_MS)
  }

  private recheck(): void {
    this.deps.auth.resolve(this.bearer).then(
      (principal) => {
        if (this.phase !== EPhase.Ready) return
        if (principal === undefined) {
          this.close(EStreamClose.Unauthenticated)
          return
        }
        this.expiresAt = principal.expiresAt
        this.armRecheck()
      },
      (error: unknown) => {
        this.deps.log?.error({
          source: 'stream',
          message: 'auth recheck failed',
          ...logFieldsOf({ error }),
        })
        if (this.phase !== EPhase.Ready) return
        if (this.deps.timers.now() >= this.expiresAt) this.close(EStreamClose.Unauthenticated)
        else this.armRecheck()
      },
    )
  }

  private send(message: StreamServerMessage): void {
    if (this.phase === EPhase.Closed) return
    this.socket.send(JSON.stringify(message))
  }

  private clearHelloTimer(): void {
    if (this.helloTimer === undefined) return
    this.deps.timers.clearTimeout(this.helloTimer)
    this.helloTimer = undefined
  }

  private clearTimers(): void {
    this.clearHelloTimer()
    for (const timer of [this.recheckTimer, this.heartbeatTimer]) {
      if (timer !== undefined) this.deps.timers.clearTimeout(timer)
    }
    this.recheckTimer = undefined
    this.heartbeatTimer = undefined
  }
}
