import type { TerminalStreamFrame } from '@dltech/atlas-protocol'

export type TerminalStreamCloseReason = 'asleep' | 'restarted' | 'detached'

const bytesOf = (frame: TerminalStreamFrame): number =>
  frame.type === 'output' ? frame.data.length : 0

export class TerminalStreamQueue {
  private frames: TerminalStreamFrame[] = []
  private bytes = 0
  private ended = false
  private readonly waiters: (() => void)[] = []

  constructor(private readonly capacity: number) {}

  push(frame: TerminalStreamFrame): void {
    if (this.ended) return
    if (frame.type === 'output') {
      this.makeRoom({ terminalId: frame.terminalId, size: bytesOf(frame) })
      this.bytes += bytesOf(frame)
    }
    this.frames.push(frame)
    this.wake()
  }

  end(reason?: TerminalStreamCloseReason): void {
    if (this.ended) return
    this.ended = true
    if (reason !== undefined) this.frames.push({ type: 'closed', reason })
    this.wake()
  }

  async next(): Promise<TerminalStreamFrame | undefined> {
    while (this.frames.length === 0) {
      if (this.ended) return undefined
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
    const frame = this.frames.shift()
    if (frame !== undefined) this.bytes -= bytesOf(frame)
    return frame
  }

  private makeRoom(args: { terminalId: string; size: number }): void {
    if (this.bytes + args.size <= this.capacity) return
    const oldest = this.frames.find(
      (frame) => frame.type === 'output' && frame.terminalId === args.terminalId,
    )
    if (oldest === undefined || oldest.type !== 'output') return
    this.frames = this.frames.filter((frame) => {
      if (frame.type !== 'output' || frame.terminalId !== args.terminalId) return true
      this.bytes -= frame.data.length
      return false
    })
    this.frames.push({ type: 'gap', terminalId: args.terminalId, offset: oldest.offset })
  }

  private wake(): void {
    for (const waiter of this.waiters.splice(0)) waiter()
  }
}
