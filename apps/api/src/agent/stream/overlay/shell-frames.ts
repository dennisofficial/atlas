import { liveFrameSchema, SHELL_BACKLOG_FRAMES, type LiveFrame } from '@dltech/atlas-protocol'

export type ShellFrame = Extract<LiveFrame, { type: 'shell-output' }>

const frameOf = (line: string): ShellFrame | undefined => {
  try {
    const parsed = liveFrameSchema.safeParse(JSON.parse(line))
    return parsed.success && parsed.data.type === 'shell-output' ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export const shellFramesOf = (lines: readonly string[]): readonly ShellFrame[] =>
  lines.map(frameOf).filter((frame): frame is ShellFrame => frame !== undefined)

export class ShellFrameHold {
  private pending: ShellFrame[] = []
  private readonly delivered = new Map<string, number>()

  constructor(private readonly send: (frame: ShellFrame) => boolean) {}

  hold(frame: ShellFrame): void {
    this.retain([...this.pending, frame])
  }

  flush(backlog: readonly ShellFrame[]): void {
    this.retain([...backlog, ...this.pending])
    this.drain()
  }

  drain(): void {
    for (const frame of [...this.pending].sort((left, right) => left.offset - right.offset)) {
      if (!this.send(frame)) return
      this.delivered.set(frame.shellId, frame.offset + frame.text.length)
      this.pending.splice(this.pending.indexOf(frame), 1)
    }
  }

  private retain(frames: ShellFrame[]): void {
    const through = new Map(this.delivered)
    const pending: { frame: ShellFrame; order: number }[] = []
    const ordered = frames.map((frame, order) => ({ frame, order }))
    for (const { frame, order } of ordered.sort(
      (left, right) => left.frame.offset - right.frame.offset,
    )) {
      const have = through.get(frame.shellId) ?? 0
      const end = frame.offset + frame.text.length
      if (end <= have) continue
      const offset = Math.max(have, frame.offset)
      pending.push({
        frame: { ...frame, offset, text: frame.text.slice(offset - frame.offset) },
        order,
      })
      through.set(frame.shellId, end)
    }
    this.pending = pending
      .sort((left, right) => left.order - right.order)
      .slice(-SHELL_BACKLOG_FRAMES)
      .map(({ frame }) => frame)
  }
}
