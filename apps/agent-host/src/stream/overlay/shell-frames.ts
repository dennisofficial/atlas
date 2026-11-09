import { liveFrameSchema, type LiveFrame } from '@dltech/atlas-protocol'

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
  private readonly held: ShellFrame[] = []

  constructor(private readonly send: (frame: ShellFrame) => void) {}

  hold(frame: ShellFrame): void {
    this.held.push(frame)
  }

  flush(backlog: readonly ShellFrame[]): void {
    for (const frame of [...backlog, ...this.held.splice(0)]) this.send(frame)
  }
}
