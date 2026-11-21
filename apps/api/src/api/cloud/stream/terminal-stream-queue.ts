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
      if (frame.data.length > this.capacity) {
        this.addGap(frame.terminalId, frame.offset)
        this.wake()
        return
      }
      this.evict(frame.data.length)
      this.bytes += frame.data.length
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

  private evict(needed: number): void {
    if (this.bytes + needed <= this.capacity) return
    const gaps = new Map<string, number>()
    this.frames = this.frames.filter((frame) => {
      if (frame.type !== 'output' || this.bytes + needed <= this.capacity) return true
      const gap = gaps.get(frame.terminalId)
      if (gap === undefined || frame.offset < gap) gaps.set(frame.terminalId, frame.offset)
      this.bytes -= frame.data.length
      return false
    })
    for (const [terminalId, offset] of gaps) this.addGap(terminalId, offset)
  }

  private addGap(terminalId: string, offset: number): void {
    const index = this.frames.findIndex(
      (frame) => frame.type === 'gap' && frame.terminalId === terminalId,
    )
    const existing = this.frames[index]
    if (existing === undefined) {
      this.frames.push({ type: 'gap', terminalId, offset })
      return
    }
    if (existing.type !== 'gap' || existing.offset <= offset) return
    this.frames[index] = { type: 'gap', terminalId, offset }
  }

  private wake(): void {
    for (const waiter of this.waiters.splice(0)) waiter()
  }
}
