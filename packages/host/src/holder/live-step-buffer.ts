import type { StepKey, StepStreamEvent } from '@dltech/atlas-agent'
import type { EStepEndReason } from '@dltech/atlas-core'
import { EStreamBlockKind, type LiveFrame } from '@dltech/atlas-protocol'

import type { HostTimers } from './ports'

export const LIVE_FLUSH_MS = 100
export const LIVE_FLUSH_BYTES = 4 * 1024
export const LIVE_STEP_CAP_BYTES = 512 * 1024

type Block = { kind: EStreamBlockKind; sent: number; pending: string }

type ActiveStep = {
  key: StepKey
  blocks: Map<string, Block>
  pendingBytes: number
  acceptedBytes: number
  capped: boolean
  lastFlushAt: number | undefined
  timer: unknown
}

const kindOf = (type: string): EStreamBlockKind | undefined => {
  if (type === 'text-delta') return EStreamBlockKind.Text
  if (type === 'reasoning-delta') return EStreamBlockKind.Reasoning
  return undefined
}

export class LiveStepBuffer {
  private step: ActiveStep | undefined

  constructor(
    private readonly args: {
      timers: HostTimers
      emit: (frame: LiveFrame) => void
      headSeq: () => number
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
    this.step = {
      key,
      blocks: new Map(),
      pendingBytes: 0,
      acceptedBytes: 0,
      capped: false,
      lastFlushAt: undefined,
      timer: undefined,
    }
    this.args.emit({ type: 'step-start', key, afterSeq: this.args.headSeq() })
  }

  private close(args: { key: StepKey; reason: EStepEndReason }): void {
    if (this.step !== undefined) this.flush(this.step)
    this.drop()
    this.args.emit({ type: 'step-end', key: args.key, reason: args.reason })
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
    const block = step.blocks.get(id) ?? { kind, sent: 0, pending: '' }
    block.pending += text
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
    for (const [block, state] of step.blocks) {
      if (state.pending.length === 0) continue
      this.args.emit({
        type: 'delta',
        key: step.key,
        block,
        kind: state.kind,
        from: state.sent,
        text: state.pending,
      })
      state.sent += state.pending.length
      state.pending = ''
    }
    step.pendingBytes = 0
    step.lastFlushAt = this.args.timers.now()
  }
}
