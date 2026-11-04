import { daemonFrameSchema, type DaemonFrame, type HostFrame } from '@dltech/atlas-protocol'

import { ProtocolViolationError, SandboxUnavailableError } from './errors'
import type { DaemonConnector, DaemonSocket } from './socket'
import type { CallTimers } from './remote-calls'

const PING_MS = 10_000
const MISSES_TO_DEAD = 3
const BACKOFF_MIN_MS = 250
const BACKOFF_MAX_MS = 10_000

const CLOSE_UNAUTHENTICATED = 4001
const CLOSE_SUPERSEDED = 4002

export type LinkEvents = {
  onFrame(frame: DaemonFrame): void
  onSuperseded(reason: string): void
  onUnauthenticated(reason: string): void
  onFatal(error: Error): void
}

export class DaemonLink {
  private readonly pingMs: number
  private socket: DaemonSocket | null = null
  private connectAttempt = 0
  private failures = 0
  private linkGeneration = 0
  private misses = 0
  private pingTimer: unknown = null
  private stopReconnect: (() => void) | null = null
  private stopped = false
  private connector: (() => Promise<DaemonConnector>) | null = null
  private hello: (() => HostFrame) | null = null
  ready = false

  constructor(
    private readonly args: { timers: CallTimers; events: LinkEvents; pingMs?: number | undefined },
  ) {
    this.pingMs = args.pingMs ?? PING_MS
  }

  start(args: { connector(): Promise<DaemonConnector>; hello(): HostFrame }): void {
    this.connector = args.connector
    this.hello = args.hello
    void this.connect()
  }

  send(frame: HostFrame): void {
    this.socket?.send(JSON.stringify(frame))
  }

  schedulePing(): void {
    const arm = (): void => {
      if (this.stopped || !this.ready) return
      this.pingTimer = this.args.timers.setTimeout(() => {
        this.misses += 1
        if (this.misses >= MISSES_TO_DEAD) {
          this.socket?.close()
          return
        }
        this.send({ kind: 'ping' })
        arm()
      }, this.pingMs)
    }
    this.send({ kind: 'ping' })
    arm()
  }

  teardown(): void {
    this.stopped = true
    this.stopReconnect?.()
    this.stopReconnect = null
    this.args.timers.clearTimeout(this.pingTimer)
    this.socket?.close()
    this.socket = null
    this.ready = false
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.connector === null || this.hello === null) return
    const attempt = (this.connectAttempt += 1)
    const { connector, hello } = this
    let factory: DaemonConnector
    try {
      factory = await connector()
    } catch (error) {
      if (error instanceof SandboxUnavailableError) {
        this.args.events.onFatal(error)
        return
      }
      this.reconnectLater({ from: attempt })
      return
    }
    let socket: DaemonSocket
    try {
      socket = await factory({
        onText: (text) => this.handleText({ attempt, text }),
        onClose: (code, reason) => this.handleClose({ attempt, code, reason }),
      })
    } catch {
      this.reconnectLater({ from: attempt })
      return
    }
    this.socket = socket
    this.linkGeneration = attempt
    this.send(hello())
  }

  markReady(): void {
    this.ready = true
    this.failures = 0
  }

  private reconnectLater(args: { from: number }): void {
    if (this.stopped) return
    if (args.from !== this.connectAttempt) return
    this.failures += 1
    const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** (this.failures - 1))
    const wait = Math.floor(this.args.timers.random() * ceiling)
    const timer = this.args.timers.setTimeout(() => {
      this.stopReconnect = null
      void this.connect()
    }, wait)
    this.stopReconnect = () => this.args.timers.clearTimeout(timer)
  }

  private handleText(args: { attempt: number; text: string }): void {
    if (args.attempt !== this.linkGeneration) return
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
    if (parsed.data.kind === 'pong') {
      this.misses = 0
      return
    }
    this.args.events.onFrame(parsed.data)
  }

  private handleClose(args: { attempt: number; code: number; reason: string }): void {
    if (args.attempt !== this.linkGeneration) return
    this.args.timers.clearTimeout(this.pingTimer)
    this.ready = false
    this.socket = null
    this.misses = 0
    if (this.stopped) return
    if (args.code === CLOSE_SUPERSEDED) {
      this.args.events.onSuperseded(args.reason)
      return
    }
    if (args.code === CLOSE_UNAUTHENTICATED) {
      this.args.events.onUnauthenticated(args.reason)
      return
    }
    this.reconnectLater({ from: this.connectAttempt })
  }
}
