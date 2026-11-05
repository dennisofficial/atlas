import type { LiveFrame } from '@dltech/atlas-protocol'

import type { LiveSource } from '../live-source'

export class FakeLiveSource implements LiveSource {
  readonly buffers = new Map<string, string>()
  readonly subscribed = new Set<string>()
  beforeRead: (() => void | Promise<void>) | undefined
  afterCapture: (() => void | Promise<void>) | undefined
  private readonly frameListeners = new Set<(args: { sessionId: string; raw: string }) => void>()
  private readonly gapListeners = new Set<() => void>()

  publish(args: { sessionId: string; frame: LiveFrame; deliver?: boolean }): void {
    const json = JSON.stringify(args.frame)
    const line = `${json}\n`
    const previous = this.buffers.get(args.sessionId) ?? ''
    this.buffers.set(args.sessionId, args.frame.type === 'step-start' ? line : previous + line)
    if (args.deliver === false) return
    this.deliverRaw({ sessionId: args.sessionId, raw: json })
  }

  deliverRaw(args: { sessionId: string; raw: string }): void {
    if (!this.subscribed.has(args.sessionId)) return
    for (const listener of [...this.frameListeners]) listener(args)
  }

  gap(): void {
    for (const listener of [...this.gapListeners]) listener()
  }

  async subscribe(sessionId: string): Promise<void> {
    this.subscribed.add(sessionId)
  }

  async unsubscribe(sessionId: string): Promise<void> {
    this.subscribed.delete(sessionId)
  }

  async readBuffer(sessionId: string): Promise<string | null> {
    await this.beforeRead?.()
    const captured = this.buffers.get(sessionId) ?? null
    await this.afterCapture?.()
    return captured
  }

  onFrame(listener: (args: { sessionId: string; raw: string }) => void): () => void {
    this.frameListeners.add(listener)
    return () => {
      this.frameListeners.delete(listener)
    }
  }

  onGap(listener: () => void): () => void {
    this.gapListeners.add(listener)
    return () => {
      this.gapListeners.delete(listener)
    }
  }

  async close(): Promise<void> {}
}
