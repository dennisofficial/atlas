import type { OutgoingFrame } from './subscription-port'

export type FrameQueueStep =
  | { kind: 'frame'; frame: OutgoingFrame }
  | { kind: 'drain'; reconnectAfterMs: number }
  | { kind: 'end' }

type QueuedFrame = { frame: OutgoingFrame; bytes: number }

export class StreamFrameQueue {
  private readonly queued: QueuedFrame[] = []
  private bytes = 0
  private sent = 0
  private ended = false
  private goingAway: number | undefined
  private wake: (() => void) | undefined

  push(frame: OutgoingFrame): void {
    if (this.ended) return
    const bytes = Buffer.byteLength(JSON.stringify(frame))
    this.queued.push({ frame, bytes })
    this.bytes += bytes
    this.sent += bytes
    this.notify()
  }

  drain(reconnectAfterMs: number): void {
    if (this.ended || this.goingAway !== undefined) return
    this.goingAway = reconnectAfterMs
    this.notify()
  }

  end(): void {
    this.ended = true
    this.notify()
  }

  bufferedAmount(): number {
    return this.bytes
  }

  sentBytes(): number {
    return this.sent
  }

  async next(): Promise<FrameQueueStep> {
    for (;;) {
      if (this.goingAway !== undefined) return { kind: 'drain', reconnectAfterMs: this.goingAway }
      const entry = this.queued.shift()
      if (entry !== undefined) {
        this.bytes -= entry.bytes
        return { kind: 'frame', frame: entry.frame }
      }
      if (this.ended) return { kind: 'end' }
      await new Promise<void>((resolve) => {
        this.wake = resolve
      })
    }
  }

  private notify(): void {
    const wake = this.wake
    this.wake = undefined
    wake?.()
  }
}
