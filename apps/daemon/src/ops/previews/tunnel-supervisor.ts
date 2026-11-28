import { CallFailureError, ECallFailure, type PreviewTunnelRedial } from '@dltech/atlas-protocol'

import { ManagedProcess, type ManagedExit } from '../../process/managed'
import { TunnelClock, type TunnelClockArgs } from './tunnel-clock'
import {
  REGISTERED_MARKER,
  exitLabelOf,
  tailOf,
  waitForRegistration,
  type Readiness,
} from './tunnel-readiness'
import { readStored, type StoredTunnel, writeStored } from './tunnel-token'

const OUTPUT_TAIL_CHARS = 2_000
const BACKOFF_START_MS = 1_000
const BACKOFF_MAX_MS = 30_000
const HEARTBEAT_MS = 2_000
const decoder = new TextDecoder()

export type TunnelState = 'stopped' | 'starting' | 'up' | 'failed'

export type TunnelStatus = {
  state: TunnelState
  pid?: number
  restarts: number
  upAt?: string
  lastError?: string
  tail: string
  lastRedial?: PreviewTunnelRedial
}

export type TunnelSupervisorArgs = TunnelClockArgs & {
  binary: string
  env: Record<string, string | undefined>
  file: string
  readyTimeoutMs: number
  heartbeatMs?: number | undefined
  onRedial?: ((result: PreviewTunnelRedial) => void) | undefined
  log(line: string): void
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export class TunnelSupervisor {
  private state: TunnelState = 'stopped'
  private child: ManagedProcess | undefined
  private registered = false
  private output = ''
  private restarts = 0
  private lastError: string | undefined
  private token: StoredTunnel | undefined
  private backoffMs = BACKOFF_START_MS
  private timer: ReturnType<typeof setTimeout> | undefined
  private pending: Promise<TunnelStatus> | undefined
  private stopping = false
  private upAt: string | undefined
  private readonly clock: TunnelClock
  private redialing = false
  private lastRedial: PreviewTunnelRedial | undefined
  private readonly heartbeat: ReturnType<typeof setInterval>

  constructor(private readonly args: TunnelSupervisorArgs) {
    this.clock = new TunnelClock(args)
    this.heartbeat = setInterval(() => this.watchForSuspend(), args.heartbeatMs ?? HEARTBEAT_MS)
    this.heartbeat.unref?.()
  }

  storedToken(): string | undefined {
    this.token ??= readStored(this.args.file)
    return this.token?.tunnelToken
  }

  async start(token?: string): Promise<TunnelStatus> {
    if (token !== undefined) this.remember(token)
    if (this.storedToken() === undefined) {
      throw new CallFailureError({
        code: ECallFailure.InvalidInput,
        message: 'no tunnel token has been published to this pod yet',
      })
    }
    this.stopping = false
    this.backoffMs = BACKOFF_START_MS
    this.cancelRestart()
    if (this.redialing) return this.status()
    if (this.child !== undefined) return this.status()
    this.pending ??= this.launch()
    let status: TunnelStatus
    try {
      status = await this.pending
    } finally {
      this.pending = undefined
    }
    if (status.state === 'failed') {
      throw new CallFailureError({
        code: ECallFailure.SpawnFailed,
        message: status.lastError ?? 'cloudflared did not come up',
      })
    }
    return status
  }

  status(): TunnelStatus {
    return {
      state: this.state,
      ...(this.child === undefined ? {} : { pid: this.child.pid }),
      restarts: this.restarts,
      ...(this.upAt === undefined ? {} : { upAt: this.upAt }),
      ...(this.lastError === undefined ? {} : { lastError: this.lastError }),
      tail: tailOf(this.output),
      ...(this.lastRedial === undefined ? {} : { lastRedial: this.lastRedial }),
    }
  }

  async stop(): Promise<void> {
    this.stopping = true
    clearInterval(this.heartbeat)
    this.cancelRestart()
    const child = this.child
    this.child = undefined
    this.registered = false
    this.upAt = undefined
    this.state = 'stopped'
    if (child === undefined) return
    child.kill()
    await child.exit().catch(() => undefined)
  }

  private remember(token: string): void {
    const current = this.storedToken()
    if (current === token) return
    const stored: StoredTunnel = {
      tunnelToken: token,
      revision: (this.token?.revision ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    }
    this.token = stored
    writeStored({ file: this.args.file, stored })
  }

  private async launch(args?: { onRegistered(ms: number): void }): Promise<TunnelStatus> {
    const launchingAt = this.clock.now()
    let registeredAt: number | undefined
    const token = this.storedToken()
    if (token === undefined) {
      throw new CallFailureError({
        code: ECallFailure.InvalidInput,
        message: 'no tunnel token has been published to this pod yet',
      })
    }
    this.state = 'starting'
    this.registered = false
    this.lastError = undefined
    this.output = ''
    const capture = (bytes: Uint8Array): void => {
      this.output = (this.output + decoder.decode(bytes, { stream: true })).slice(
        -OUTPUT_TAIL_CHARS,
      )
      if (registeredAt === undefined && this.output.includes(REGISTERED_MARKER)) {
        registeredAt = this.clock.now()
        args?.onRegistered(Math.max(0, registeredAt - launchingAt))
      }
    }
    let child: ManagedProcess
    try {
      child = ManagedProcess.spawn({
        cmd: [this.args.binary, 'tunnel', '--no-autoupdate', 'run'],
        env: { ...this.args.env, TUNNEL_TOKEN: token },
        onStdout: capture,
        onStderr: capture,
      })
    } catch (error) {
      this.state = 'failed'
      this.lastError = `cloudflared could not start: ${messageOf(error)}`
      this.args.log(`previews: ${this.lastError}`)
      return this.status()
    }
    this.child = child
    void child.exit().then((exit) => this.handleExit({ child, exit }))
    const readiness = await waitForRegistration({
      child,
      output: () => this.output,
      timeoutMs: this.args.readyTimeoutMs,
    })
    if (readiness.kind === 'registered') {
      this.registered = true
      this.state = 'up'
      this.upAt = new Date().toISOString()
      return this.status()
    }
    if (this.child === child) {
      this.child = undefined
      child.kill()
    }
    this.state = 'failed'
    this.lastError = this.failureText({ readiness })
    this.args.log(`previews: ${this.lastError}`)
    return this.status()
  }

  private failureText(args: { readiness: Readiness }): string {
    const tail = tailOf(this.output)
    if (args.readiness.kind === 'exited') {
      return `cloudflared exited with ${exitLabelOf(args.readiness.exit)} before its tunnel connected; output: ${tail}`
    }
    const waited = args.readiness.kind === 'timeout' ? `${this.args.readyTimeoutMs} ms` : 'the wait'
    return `cloudflared did not register a tunnel connection within ${waited}; output: ${tail}`
  }

  private handleExit(args: { child: ManagedProcess; exit: ManagedExit }): void {
    if (this.child !== args.child) return
    this.child = undefined
    const wasRegistered = this.registered
    this.registered = false
    this.upAt = undefined
    if (this.stopping || !wasRegistered) {
      if (this.stopping) this.state = 'stopped'
      return
    }
    this.restarts += 1
    this.state = 'failed'
    this.lastError = `cloudflared exited with ${exitLabelOf(args.exit)}; restarting in ${this.backoffMs} ms`
    this.args.log(`previews: ${this.lastError}`)
    this.scheduleRestart()
  }

  private scheduleRestart(): void {
    this.cancelRestart()
    const delay = this.backoffMs
    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS)
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.stopping || this.child !== undefined) return
      void this.launch().catch((error: unknown) => {
        this.args.log(`previews: restarting cloudflared failed: ${messageOf(error)}`)
      })
    }, delay)
  }

  private watchForSuspend(): void {
    const gap = this.clock.suspendGap()
    if (gap === undefined) return
    if (this.state !== 'up' || this.child === undefined) return
    void this.redial(gap)
  }

  private async redial(
    args: Pick<PreviewTunnelRedial, 'reason' | 'gapMs' | 'skewMs'>,
  ): Promise<void> {
    if (this.redialing || this.stopping) return
    this.redialing = true
    try {
      this.args.log(
        `previews: the pod did not run for ${args.gapMs} ms, so cloudflared is restarted instead of waiting for its edge connection to time out`,
      )
      this.registered = false
      this.upAt = undefined
      this.state = 'starting'
      this.restarts += 1
      this.cancelRestart()
      this.backoffMs = BACKOFF_START_MS
      const child = this.child
      this.child = undefined
      const stoppingAt = this.clock.now()
      if (child !== undefined) {
        child.kill()
        await child.exit().catch(() => undefined)
      }
      const stopMs = Math.max(0, this.clock.now() - stoppingAt)
      if (this.stopping) return
      const launchingAt = this.clock.now()
      let registeredMs: number | undefined
      const status = await this.launch({
        onRegistered: (ms) => {
          registeredMs = ms
        },
      })
      this.lastRedial = {
        ...args,
        id: crypto.randomUUID(),
        stopMs,
        registerMs: registeredMs ?? Math.max(0, this.clock.now() - launchingAt),
        ok: status.state === 'up',
      }
      this.args.onRedial?.(this.lastRedial)
    } finally {
      this.redialing = false
    }
  }

  private cancelRestart(): void {
    if (this.timer === undefined) return
    clearTimeout(this.timer)
    this.timer = undefined
  }
}
