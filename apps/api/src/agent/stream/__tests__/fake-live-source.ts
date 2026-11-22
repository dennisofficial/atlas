import type { FrameStamp, LiveFrame } from '@dltech/atlas-protocol'

import type { LiveSource } from '../live-source'

type WithoutStamp<F> = F extends unknown ? Omit<F, 'at'> & { at?: FrameStamp } : never

export type TestFrame = WithoutStamp<LiveFrame>

export class FakeLiveSource implements LiveSource {
  readonly buffers = new Map<string, string>()
  readonly shellBacklogs = new Map<string, string[]>()
  readonly subscribed = new Set<string>()
  beforeRead: (() => void | Promise<void>) | undefined
  afterCapture: (() => void | Promise<void>) | undefined
  reads = 0
  failReads = 0
  epoch = 1
  private nextN = 0
  private readonly frameListeners = new Set<(args: { key: string; raw: string }) => void>()
  private readonly gapListeners = new Set<() => void>()

  stamped(frame: TestFrame): LiveFrame {
    if (frame.type !== 'step-start' && frame.type !== 'delta' && frame.type !== 'step-end') {
      return frame
    }
    const at = frame.at ?? { epoch: this.epoch, n: this.nextN }
    if (frame.at === undefined) this.nextN += 1
    return { ...frame, at }
  }

  publish(args: { key: string; frame: TestFrame; deliver?: boolean }): void {
    const frame = this.stamped(args.frame)
    const json = JSON.stringify(frame)
    const line = `${json}\n`
    const previous = this.buffers.get(args.key) ?? ''
    this.buffers.set(args.key, frame.type === 'step-start' ? line : previous + line)
    if (args.deliver === false) return
    this.deliverRaw({ key: args.key, raw: json })
  }

  deliverRaw(args: { key: string; raw: string }): void {
    if (!this.subscribed.has(args.key)) return
    for (const listener of [...this.frameListeners]) listener(args)
  }

  gap(): void {
    for (const listener of [...this.gapListeners]) listener()
  }

  async subscribe(key: string): Promise<void> {
    this.subscribed.add(key)
  }

  async unsubscribe(key: string): Promise<void> {
    this.subscribed.delete(key)
  }

  async readShellBacklog(key: string): Promise<string[]> {
    return this.shellBacklogs.get(key) ?? []
  }

  async readBuffer(key: string): Promise<string | null> {
    this.reads += 1
    if (this.failReads > 0) {
      this.failReads -= 1
      throw new Error('read refused')
    }
    await this.beforeRead?.()
    const captured = this.buffers.get(key) ?? null
    await this.afterCapture?.()
    return captured
  }

  onFrame(listener: (args: { key: string; raw: string }) => void): () => void {
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
