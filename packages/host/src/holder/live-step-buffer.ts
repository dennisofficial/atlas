import type { StepKey, StepStreamEvent } from '@dltech/atlas-agent'
import type { EStepEndReason } from '@dltech/atlas-core'
import { EStreamBlockKind, type FrameStamp, type LiveFrame } from '@dltech/atlas-protocol'

import type { HostTimers } from './ports'

export const LIVE_FLUSH_MS = 100
export const LIVE_FLUSH_BYTES = 4 * 1024
export const LIVE_STEP_CAP_BYTES = 512 * 1024

type Block = { kind: EStreamBlockKind; sent: number; text: string }

type ActiveStep = {
  key: StepKey
  afterSeq: number
  blocks: Map<string, Block>
  pendingBytes: number
  acceptedBytes: number
  capped: boolean
  resync: boolean
  lastFlushAt: number | undefined
  timer: unknown
}

const kindOf = (type: string): EStreamBlockKind | undefined => {
  if (type === 'text-delta') return EStreamBlockKind.Text
  if (type === 'reasoning-delta') return EStreamBlockKind.Reasoning
  return undefined
}

type Without<F> = F extends unknown ? Omit<F, 'at'> : never

type Unstamped = Without<Extract<LiveFrame, { at: FrameStamp }>>

export class LiveStepBuffer {
  private step: ActiveStep | undefined
  private n = 0

  constructor(
    private readonly args: {
      timers: HostTimers
      emit: (frame: LiveFrame) => Promise<void>
      headSeq: () => number
      epoch: number
    },
  ) {}

  push(event: StepStreamEvent): void {
    if (event.type === 'step-start') {
      this.open(event.key)
      return
    }
    if (event.type === 'step-end') {
      this.close({ key: event.key, reason: event.reason })
      return
    }
    this.accept(event.chunk)
  }

  private open(key: StepKey): void {
    if (this.step !== undefined) this.flush(this.step)
    this.drop()
    const step: ActiveStep = {
      key,
      afterSeq: this.args.headSeq(),
      blocks: new Map(),
      pendingBytes: 0,
      acceptedBytes: 0,
      capped: false,
      resync: false,
      lastFlushAt: undefined,
      timer: undefined,
    }
    this.step = step
    this.send({ step, frame: { type: 'step-start', key, afterSeq: step.afterSeq } })
  }

  private stamp(frame: Unstamped): LiveFrame {
    const at = { epoch: this.args.epoch, n: this.n }
    this.n += 1
    return { ...frame, at }
  }

  private close(args: { key: StepKey; reason: EStepEndReason }): void {
    if (this.step !== undefined) this.flush(this.step)
    this.drop()
    this.args
      .emit(this.stamp({ type: 'step-end', key: args.key, reason: args.reason }))
      .catch(() => undefined)
  }

  private send(args: { step: ActiveStep; frame: Unstamped }): void {
    const { step, frame } = args
    this.args.emit(this.stamp(frame)).catch(() => this.markResync(step))
  }

  private markResync(step: ActiveStep): void {
    if (this.step !== step) return
    step.resync = true
    if (step.timer !== undefined) return
    step.timer = this.args.timers.setTimeout(() => {
      step.timer = undefined
      this.flush(step)
    }, LIVE_FLUSH_MS)
  }

  private drop(): void {
    if (this.step?.timer !== undefined) this.args.timers.clearTimeout(this.step.timer)
    this.step = undefined
  }

  private accept(chunk: { type: string; id?: string; text?: string }): void {
    const step = this.step
    const kind = kindOf(chunk.type)
    if (step === undefined || kind === undefined) return
    const { id, text } = chunk
    if (id === undefined || text === undefined || text.length === 0) return
    const bytes = Buffer.byteLength(text)
    if (step.capped) return
    if (step.acceptedBytes + bytes > LIVE_STEP_CAP_BYTES) {
      step.capped = true
      return
    }
    step.acceptedBytes += bytes
    step.pendingBytes += bytes
    const block = step.blocks.get(id) ?? { kind, sent: 0, text: '' }
    block.text += text
    step.blocks.set(id, block)
    this.schedule(step)
  }

  private schedule(step: ActiveStep): void {
    const { timers } = this.args
    const dueIn =
      step.lastFlushAt === undefined ? 0 : step.lastFlushAt + LIVE_FLUSH_MS - timers.now()
    if (step.pendingBytes >= LIVE_FLUSH_BYTES || dueIn <= 0) {
      this.flush(step)
      return
    }
    if (step.timer !== undefined) return
    step.timer = timers.setTimeout(() => {
      step.timer = undefined
      this.flush(step)
    }, dueIn)
  }

  private flush(step: ActiveStep): void {
    if (step.timer !== undefined) {
      this.args.timers.clearTimeout(step.timer)
      step.timer = undefined
    }
    const resync = step.resync
    if (resync) {
      step.resync = false
      this.send({
        step,
        frame: { type: 'step-start', key: step.key, afterSeq: step.afterSeq },
      })
    }
    for (const [block, state] of step.blocks) {
      const from = resync ? 0 : state.sent
      if (state.text.length === from) continue
      this.send({
        step,
        frame: {
          type: 'delta',
          key: step.key,
          block,
          kind: state.kind,
          from,
          text: state.text.slice(from),
        },
      })
      state.sent = state.text.length
    }
    step.pendingBytes = 0
    step.lastFlushAt = this.args.timers.now()
  }
}
