import { CallFailureError, ECallFailure, type TerminalExit } from '@dltech/atlas-protocol'

import { missingTerminal, type SpawnedTerminal } from './pty'

export const SCROLLBACK_BYTES = 1024 * 1024

export type Scrollback = {
  total: number
  push(chunk: Uint8Array): number
  slice(args: { from: number }): { offset: number; bytes: Uint8Array }
  finish(exit: TerminalExit): void
  exited(): TerminalExit | null
  waitExit(): Promise<TerminalExit>
}

export const createScrollback = (limit = SCROLLBACK_BYTES): Scrollback => {
  let kept: Uint8Array = new Uint8Array(0)
  let total = 0
  let exited: TerminalExit | null = null
  const exitWaiters = new Set<(exit: TerminalExit) => void>()
  return {
    get total() {
      return total
    },
    push: (chunk) => {
      const offset = total
      total += chunk.length
      kept = Buffer.concat([kept, chunk])
      const extra = kept.length - limit
      if (extra > 0) kept = kept.subarray(extra)
      return offset
    },
    slice: ({ from }) => {
      const floor = total - kept.length
      const offset = Math.max(from, floor)
      return { offset, bytes: kept.subarray(offset - floor) }
    },
    finish: (exit) => {
      if (exited !== null) return
      exited = exit
      for (const waiter of [...exitWaiters]) waiter(exit)
      exitWaiters.clear()
    },
    exited: () => exited,
    waitExit: () =>
      exited !== null
        ? Promise.resolve(exited)
        : new Promise<TerminalExit>((resolve) => exitWaiters.add(resolve)),
  }
}

export type HeldTerminal = {
  spawned: SpawnedTerminal
  scrollback: Scrollback
}

export class TerminalRegistry {
  private readonly terminals = new Map<string, HeldTerminal>()
  private readonly scrollbacks = new Map<string, Scrollback>()

  size(): number {
    return this.terminals.size
  }

  add(args: { terminalId: string; held: HeldTerminal }): void {
    if (this.terminals.has(args.terminalId) || this.scrollbacks.has(args.terminalId)) {
      throw new CallFailureError({
        code: ECallFailure.AlreadyExists,
        message: `a terminal ${args.terminalId} is already open`,
      })
    }
    this.terminals.set(args.terminalId, args.held)
    this.scrollbacks.set(args.terminalId, args.held.scrollback)
  }

  markExited(terminalId: string): void {
    this.terminals.delete(terminalId)
  }

  require(terminalId: string): HeldTerminal {
    const held = this.terminals.get(terminalId)
    if (held === undefined) throw missingTerminal(terminalId)
    return held
  }

  scrollbackOf(terminalId: string): Scrollback {
    const scrollback = this.scrollbacks.get(terminalId)
    if (scrollback === undefined) throw missingTerminal(terminalId)
    return scrollback
  }

  drop(terminalId: string): void {
    this.terminals.delete(terminalId)
    this.scrollbacks.delete(terminalId)
  }

  async closeAll(): Promise<void> {
    const held = [...this.terminals.values()]
    for (const terminal of held) terminal.spawned.killTree()
    await Promise.allSettled(held.map((terminal) => terminal.spawned.exited))
  }
}
