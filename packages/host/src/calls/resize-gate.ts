import {
  decideResizeWait,
  EResizeWait,
  EPodResizeProbe,
  type PodResizeOpen,
} from '@dltech/atlas-core'

import type { CallTimers } from './remote-calls'

export type ResizeGateArgs = {
  timers: CallTimers
  now(): number
  probe(args: { open: PodResizeOpen }): Promise<EPodResizeProbe>
}

type HeldResize = { open: PodResizeOpen; reason: string }

export class ResizeGate {
  private held: HeldResize | undefined
  private completed = -1
  private probes = 0
  private lastProbe: EPodResizeProbe | undefined
  private timer: unknown
  private readonly waiters = new Set<() => void>()

  constructor(private readonly args: ResizeGateArgs) {}

  get open(): PodResizeOpen | undefined {
    return this.held?.open
  }

  get reason(): string | undefined {
    return this.held?.reason
  }

  hold(args: HeldResize): void {
    if (args.open.generation <= this.completed) return
    if (this.held !== undefined && args.open.generation < this.held.open.generation) return
    if (this.held?.open.generation === args.open.generation) {
      this.held = args
      return
    }
    this.held = args
    this.probes = 0
    this.lastProbe = undefined
    this.stopTimer()
    void this.check()
  }

  settled(args: { generation: number }): boolean {
    this.completed = Math.max(this.completed, args.generation)
    if (this.held === undefined || args.generation < this.held.open.generation) return false
    this.release()
    return true
  }

  async wait(args: { signal?: AbortSignal | undefined }): Promise<void> {
    if (this.held === undefined) return
    const { signal } = args
    if (signal?.aborted === true) return
    await new Promise<void>((resolve) => {
      const done = (): void => {
        signal?.removeEventListener('abort', done)
        this.waiters.delete(done)
        resolve()
      }
      this.waiters.add(done)
      signal?.addEventListener('abort', done, { once: true })
    })
  }

  release(): void {
    this.stopTimer()
    this.held = undefined
    for (const resolve of [...this.waiters]) resolve()
    this.waiters.clear()
  }

  private async check(): Promise<void> {
    const held = this.held
    if (held === undefined) return
    const decision = decideResizeWait({
      open: held.open,
      now: this.args.now(),
      probe: this.lastProbe,
      probes: this.probes,
    })
    if (decision.wait === EResizeWait.Proceed) {
      this.completed = Math.max(this.completed, held.open.generation)
      this.release()
      return
    }
    if (decision.probe) {
      this.probes += 1
      const probe = await this.args.probe({ open: held.open }).catch(() => EPodResizeProbe.Unknown)
      if (this.held?.open.generation !== held.open.generation) return
      this.lastProbe = probe
      await this.check()
      return
    }
    const delay = Math.max(0, decision.checkAt - this.args.now())
    this.timer = this.args.timers.setTimeout(() => {
      this.timer = undefined
      void this.check()
    }, delay)
  }

  private stopTimer(): void {
    if (this.timer === undefined) return
    this.args.timers.clearTimeout(this.timer)
    this.timer = undefined
  }
}
