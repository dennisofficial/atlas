import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { CallFailureError, ECallFailure } from '@dltech/atlas-protocol'

import { ManagedProcess, type ManagedExit } from '../../process/managed'

const REGISTERED_MARKER = 'Registered tunnel connection'
const OUTPUT_TAIL_CHARS = 2_000
const READY_POLL_MS = 100
const BACKOFF_START_MS = 1_000
const BACKOFF_MAX_MS = 30_000
const TOKEN_FILE_MODE = 0o600
const decoder = new TextDecoder()

export type TunnelState = 'stopped' | 'starting' | 'up' | 'failed'

export type TunnelStatus = {
  state: TunnelState
  pid?: number
  restarts: number
  lastError?: string
  tail: string
}

export type TunnelSupervisorArgs = {
  binary: string
  env: Record<string, string | undefined>
  file: string
  readyTimeoutMs: number
  log(line: string): void
}

type StoredTunnel = { tunnelToken: string; revision: number; updatedAt: string }

type Readiness =
  | { kind: 'registered' }
  | { kind: 'exited'; exit: ManagedExit }
  | { kind: 'timeout' }

export const tokenFileOf = (home: string): string => `${home}/previews.json`

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const tailOf = (output: string): string =>
  output === '' ? '(cloudflared printed nothing)' : output.slice(-OUTPUT_TAIL_CHARS)

const exitLabelOf = (exit: ManagedExit): string =>
  exit.exitCode !== null ? `code ${exit.exitCode}` : `signal ${exit.signal ?? 'unknown'}`

const readStored = (file: string): StoredTunnel | undefined => {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const { tunnelToken, revision, updatedAt } = parsed as Record<string, unknown>
  if (typeof tunnelToken !== 'string' || tunnelToken === '') return undefined
  return {
    tunnelToken,
    revision: typeof revision === 'number' ? revision : 0,
    updatedAt: typeof updatedAt === 'string' ? updatedAt : new Date(0).toISOString(),
  }
}

const writeStored = (args: { file: string; stored: StoredTunnel }): void => {
  mkdirSync(dirname(args.file), { recursive: true })
  const temporary = `${args.file}.tmp`
  writeFileSync(temporary, `${JSON.stringify(args.stored)}\n`, { mode: TOKEN_FILE_MODE })
  chmodSync(temporary, TOKEN_FILE_MODE)
  renameSync(temporary, args.file)
}

const waitForRegistration = (args: {
  child: ManagedProcess
  output: () => string
  timeoutMs: number
}): Promise<Readiness> =>
  new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (readiness: Readiness): void => {
      if (timer !== undefined) clearTimeout(timer)
      resolve(readiness)
    }
    const deadline = Date.now() + args.timeoutMs
    const check = (): void => {
      if (args.output().includes(REGISTERED_MARKER)) return finish({ kind: 'registered' })
      if (Date.now() >= deadline) return finish({ kind: 'timeout' })
      timer = setTimeout(check, READY_POLL_MS)
    }
    void args.child.exit().then((exit) => finish({ kind: 'exited', exit }))
    check()
  })

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

  constructor(private readonly args: TunnelSupervisorArgs) {}

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
      ...(this.lastError === undefined ? {} : { lastError: this.lastError }),
      tail: tailOf(this.output),
    }
  }

  async stop(): Promise<void> {
    this.stopping = true
    this.cancelRestart()
    const child = this.child
    this.child = undefined
    this.registered = false
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

  private async launch(): Promise<TunnelStatus> {
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

  private cancelRestart(): void {
    if (this.timer === undefined) return
    clearTimeout(this.timer)
    this.timer = undefined
  }
}
