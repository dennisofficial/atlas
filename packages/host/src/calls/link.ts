import { daemonFrameSchema, type DaemonFrame, type HostFrame } from '@dltech/atlas-protocol'
import type { LogPort } from '@dltech/atlas-observability'

import { ProtocolViolationError, SandboxUnavailableError } from './errors'
import type { DaemonConnector, DaemonSocket } from './socket'
import type { CallTimers } from './remote-calls'

const PING_MS = 10_000
const MISSES_TO_DEAD = 3
export const HANDSHAKE_MS = 15_000
const BACKOFF_MIN_MS = 250
const BACKOFF_MAX_MS = 10_000

const CLOSE_UNAUTHENTICATED = 4001
const CLOSE_SUPERSEDED = 4002

export type LinkEvents = {
  onFrame(frame: DaemonFrame): void
  onDown(): void
  onSuperseded(reason: string): void
  onUnauthenticated(reason: string): void
  onFatal(error: Error): void
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export class DaemonLink {
  private readonly pingMs: number
  private readonly handshakeMs: number
  private socket: DaemonSocket | null = null
  private attempt = 0
  private failures = 0
  private misses = 0
  private pingTimer: unknown = null
  private handshakeTimer: unknown = null
  private connecting: AbortController | null = null
  private stopReconnect: (() => void) | null = null
  private stopped = false
  private connector: (() => Promise<DaemonConnector>) | null = null
  private hello: (() => HostFrame) | null = null
  ready = false

  constructor(
    private readonly args: {
      timers: CallTimers
      events: LinkEvents
      pingMs?: number | undefined
      handshakeMs?: number | undefined
      log?: LogPort | undefined
      sessionId?: string | undefined
    },
  ) {
    this.pingMs = args.pingMs ?? PING_MS
    this.handshakeMs = args.handshakeMs ?? HANDSHAKE_MS
  }

  start(args: { connector(): Promise<DaemonConnector>; hello(): HostFrame }): void {
    this.connector = args.connector
    this.hello = args.hello
    this.stopped = false
    this.failures = 0
    this.misses = 0
    void this.connect()
  }

  send(frame: HostFrame): void {
    this.socket?.send(JSON.stringify(frame))
  }

  schedulePing(): void {
    const attempt = this.attempt
    const arm = (): void => {
      if (this.stopped || !this.ready || attempt !== this.attempt) return
      this.pingTimer = this.args.timers.setTimeout(() => {
        if (attempt !== this.attempt) return
        this.misses += 1
        if (this.misses >= MISSES_TO_DEAD) {
          this.abandon({ reason: `${MISSES_TO_DEAD} pings went unanswered` })
          return
        }
        this.send({ kind: 'ping' })
        arm()
      }, this.pingMs)
    }
    this.send({ kind: 'ping' })
    arm()
  }

  markReady(): void {
    this.ready = true
    this.failures = 0
    this.args.timers.clearTimeout(this.handshakeTimer)
  }

  restart(): void {
    if (this.connector === null || this.hello === null) return
    this.start({ connector: this.connector, hello: this.hello })
  }

  teardown(): void {
    this.stopped = true
    this.attempt += 1
    this.stopReconnect?.()
    this.stopReconnect = null
    this.clearTimers()
    this.cancelConnect()
    this.socket?.close()
    this.socket = null
    this.ready = false
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.connector === null || this.hello === null) return
    const attempt = (this.attempt += 1)
    const { connector, hello } = this
    this.cancelConnect()
    const connecting = new AbortController()
    this.connecting = connecting
    let factory: DaemonConnector
    try {
      factory = await connector()
    } catch (error) {
      if (attempt !== this.attempt) return
      if (error instanceof SandboxUnavailableError) {
        this.args.events.onFatal(error)
        return
      }
      this.abandon({ reason: `the connector failed: ${messageOf(error)}` })
      return
    }
    if (attempt !== this.attempt) return
    this.armHandshake(attempt)
    let socket: DaemonSocket
    try {
      socket = await factory({
        onText: (text) => this.handleText({ attempt, text }),
        onClose: (code, reason) => this.handleClose({ attempt, code, reason }),
        signal: connecting.signal,
      })
    } catch (error) {
      if (attempt !== this.attempt) return
      this.abandon({ reason: `the socket did not open: ${messageOf(error)}` })
      return
    }
    if (attempt !== this.attempt) {
      socket.close()
      return
    }
    if (this.connecting === connecting) this.connecting = null
    this.socket = socket
    this.send(hello())
  }

  private armHandshake(attempt: number): void {
    this.args.timers.clearTimeout(this.handshakeTimer)
    this.handshakeTimer = this.args.timers.setTimeout(() => {
      if (attempt !== this.attempt || this.ready) return
      this.abandon({ reason: `the daemon did not finish the handshake in ${this.handshakeMs} ms` })
    }, this.handshakeMs)
  }

  private abandon(args: { reason: string }): void {
    if (this.stopped) return
    this.attempt += 1
    this.clearTimers()
    this.cancelConnect()
    const socket = this.socket
    const wasReady = this.ready
    this.socket = null
    this.ready = false
    this.misses = 0
    socket?.close()
    this.args.log?.warn({
      source: 'calls.link',
      message: `daemon link down: ${args.reason}`,
      data: { sessionId: this.args.sessionId, wasReady, failures: this.failures },
    })
    if (wasReady) this.args.events.onDown()
    this.reconnectLater()
  }

  private reconnectLater(): void {
    if (this.stopped) return
    this.failures += 1
    const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** (this.failures - 1))
    const wait = Math.floor(this.args.timers.random() * ceiling)
    const timer = this.args.timers.setTimeout(() => {
      this.stopReconnect = null
      void this.connect()
    }, wait)
    this.stopReconnect = () => this.args.timers.clearTimeout(timer)
  }

  private cancelConnect(): void {
    this.connecting?.abort()
    this.connecting = null
  }

  private clearTimers(): void {
    this.args.timers.clearTimeout(this.pingTimer)
    this.args.timers.clearTimeout(this.handshakeTimer)
  }

  private handleText(args: { attempt: number; text: string }): void {
    if (args.attempt !== this.attempt) return
    let json: unknown
    try {
      json = JSON.parse(args.text)
    } catch {
      this.args.events.onFatal(new ProtocolViolationError('daemon sent invalid json'))
      return
    }
    const parsed = daemonFrameSchema.safeParse(json)
    if (!parsed.success) {
      this.args.events.onFatal(
        new ProtocolViolationError(`daemon sent an invalid frame: ${parsed.error.message}`),
      )
      return
    }
    this.misses = 0
    if (parsed.data.kind === 'pong') return
    this.args.events.onFrame(parsed.data)
  }

  private handleClose(args: { attempt: number; code: number; reason: string }): void {
    if (args.attempt !== this.attempt || this.stopped) return
    this.socket = null
    if (args.code === CLOSE_SUPERSEDED || args.code === CLOSE_UNAUTHENTICATED) {
      this.attempt += 1
      this.clearTimers()
      this.ready = false
      if (args.code === CLOSE_SUPERSEDED) this.args.events.onSuperseded(args.reason)
      else this.args.events.onUnauthenticated(args.reason)
      return
    }
    const detail = args.reason === '' ? `${args.code}` : `${args.code} ${args.reason}`
    this.abandon({ reason: `the socket closed (${detail})` })
  }
}
