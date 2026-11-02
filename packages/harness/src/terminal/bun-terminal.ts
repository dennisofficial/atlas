import { EServeEnv } from '@dltech/atlas-wire'

import { withoutLauncherPrivateEnv } from '../execution/child-env'
import { workloadCommand } from '../execution/workload-priority'

import { TerminalPort, type TerminalListener } from './terminal.port'

export const MAX_OPEN_TERMINALS = 8
const EOF_GRACE_MS = 100
const KILL_GRACE_MS = 2000

type Held = { process: Bun.Subprocess; terminal: Bun.Terminal }

const shellOf = (env: Record<string, string | undefined>): string => {
  const named = env.SHELL
  return named === undefined || named === '' ? '/bin/bash' : named
}

const terminalEnv = (
  source: Record<string, string | undefined>,
): Record<string, string | undefined> => {
  const env: Record<string, string | undefined> = {
    ...withoutLauncherPrivateEnv(source),
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  }
  delete env[EServeEnv.Token]
  return env
}

const signalNameOf = (signal: string | number | null): string | null =>
  typeof signal === 'string' ? signal : null

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export class BunTerminalPort extends TerminalPort {
  private readonly held = new Map<string, Held>()
  private readonly listeners = new Set<TerminalListener>()
  private opened = 0

  constructor(
    private readonly args: { root: string; env?: Record<string, string | undefined> | undefined },
  ) {
    super()
  }

  async open({ cols, rows }: { cols: number; rows: number }): Promise<{ terminalId: string }> {
    if (this.held.size >= MAX_OPEN_TERMINALS) {
      throw new Error(`this session already has ${MAX_OPEN_TERMINALS} terminals open`)
    }
    this.opened += 1
    const terminalId = `term_${this.opened}`
    const decoder = new TextDecoder()
    const env = this.args.env ?? process.env
    let reachedEof!: () => void
    const eof = new Promise<void>((resolve) => {
      reachedEof = resolve
    })

    const child = Bun.spawn(workloadCommand({ cmd: [shellOf(env)], cwd: this.args.root, env }), {
      cwd: this.args.root,
      env: terminalEnv(env),
      terminal: {
        cols,
        rows,
        data: (_terminal, chunk) => {
          const data = decoder.decode(chunk, { stream: true })
          if (data !== '') this.emit({ type: 'output', terminalId, data })
        },
        exit: () => reachedEof(),
      },
    })
    const terminal = child.terminal
    if (terminal === undefined) {
      child.kill()
      throw new Error('this runtime could not attach a pseudo-terminal')
    }
    this.held.set(terminalId, { process: child, terminal })

    void child.exited.then(async (exitCode) => {
      await Promise.race([eof, wait(EOF_GRACE_MS)])
      this.held.delete(terminalId)
      if (!terminal.closed) terminal.close()
      this.emit({ type: 'exit', terminalId, exitCode, signal: signalNameOf(child.signalCode) })
    })
    return { terminalId }
  }

  async write({ terminalId, data }: { terminalId: string; data: string }): Promise<boolean> {
    const held = this.held.get(terminalId)
    if (held === undefined || held.terminal.closed) return false
    held.terminal.write(data)
    return true
  }

  async resize(args: { terminalId: string; cols: number; rows: number }): Promise<boolean> {
    const held = this.held.get(args.terminalId)
    if (held === undefined || held.terminal.closed) return false
    held.terminal.resize(args.cols, args.rows)
    return true
  }

  async close({ terminalId }: { terminalId: string }): Promise<boolean> {
    const held = this.held.get(terminalId)
    if (held === undefined) return false
    if (!held.terminal.closed) held.terminal.close()
    held.process.kill('SIGHUP')
    await Promise.race([held.process.exited, wait(KILL_GRACE_MS)])
    if (held.process.exitCode === null && held.process.signalCode === null) {
      held.process.kill('SIGKILL')
    }
    return true
  }

  subscribe(listener: TerminalListener): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.held.keys()].map((terminalId) => this.close({ terminalId })))
  }

  private emit(event: Parameters<TerminalListener>[0]): void {
    for (const listener of [...this.listeners]) listener(event)
  }
}
