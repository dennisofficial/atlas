import type { SpanHandle } from '@dltech/atlas-observability'

export class FirstTokenClock {
  private armed: { span: SpanHandle; promptAt: number } | undefined
  private calls = 0

  constructor(private readonly now: () => number = Date.now) {}

  arm(args: { span: SpanHandle; promptAt: number | undefined }): void {
    this.armed =
      args.promptAt === undefined ? undefined : { span: args.span, promptAt: args.promptAt }
    this.calls = 0
  }

  disarm(): void {
    this.armed = undefined
    this.calls = 0
  }

  claimsFirstCall(): boolean {
    if (this.armed === undefined) return false
    this.calls += 1
    return this.calls === 1
  }

  firstChunk(): void {
    const armed = this.armed
    if (armed === undefined) return
    this.armed = undefined
    armed.span.set({ firstTokenMs: Math.max(0, this.now() - armed.promptAt) })
  }
}
