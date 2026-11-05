import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import {
  EStreamClearReason,
  type LiveFrame,
  type StreamServerMessage,
  type StreamStepKey,
} from '@dltech/atlas-protocol'

import { FOLLOW_HIGH_WATER_BYTES } from '../follow-limits'
import { foldLiveBuffer, type FoldedStep } from './fold-live-buffer'
import { isAfter, RetiredSteps, sameStep } from './step-order'

type StepFrame = Extract<LiveFrame, { type: 'step-start' | 'delta' | 'step-end' }>

type OpenStep = { key: StreamStepKey; have: Map<string, number> }

export type OverlayWatcherArgs = {
  id: string
  send(message: StreamServerMessage): void
  bufferedAmount(): number
  readBuffer(): Promise<string | null>
  log: LogPort | undefined
}

const isStepFrame = (frame: LiveFrame): frame is StepFrame =>
  frame.type === 'step-start' || frame.type === 'delta' || frame.type === 'step-end'

export class OverlayWatcher {
  private readonly retired = new RetiredSteps()
  private open: OpenStep | undefined
  private queued: LiveFrame[] | undefined = []
  private rejoin = false
  private stale = false
  private stopped = false

  constructor(private readonly args: OverlayWatcherArgs) {}

  start(): void {
    void this.join()
  }

  resync(): void {
    if (this.queued !== undefined) {
      this.rejoin = true
      return
    }
    void this.join()
  }

  holderLost(): void {
    if (this.stopped || this.open === undefined) return
    this.retired.retire(this.open.key)
    this.open = undefined
    this.args.send({
      type: 'overlay-clear',
      id: this.args.id,
      reason: EStreamClearReason.HolderLost,
    })
  }

  stop(): void {
    this.stopped = true
    this.queued = undefined
  }

  handleFrame(frame: LiveFrame): void {
    if (this.stopped) return
    if (this.queued !== undefined) {
      this.queued.push(frame)
      return
    }
    if (this.stale && !this.overloaded()) {
      this.stale = false
      this.queued = [frame]
      void this.join()
      return
    }
    if (!isStepFrame(frame)) {
      this.emit({ type: 'frame', id: this.args.id, frame })
      return
    }
    if (this.retired.has(frame.key)) return
    if (frame.type === 'step-start') this.handleStepStart(frame.key)
    else if (frame.type === 'delta') this.handleDelta(frame)
    else this.handleStepEnd(frame)
  }

  private handleStepStart(key: StreamStepKey): void {
    const open = this.open
    if (open !== undefined) {
      if (!isAfter({ candidate: key, current: open.key })) return
      this.retired.retireBefore({ previous: open.key, next: key })
    }
    this.open = { key, have: new Map() }
    this.emit({ type: 'overlay', id: this.args.id, key, blocks: [] })
  }

  private handleDelta(frame: Extract<LiveFrame, { type: 'delta' }>): void {
    const open = this.open
    if (open === undefined || !sameStep(open.key, frame.key)) {
      if (open === undefined || isAfter({ candidate: frame.key, current: open.key })) this.resync()
      return
    }
    const have = open.have.get(frame.block) ?? 0
    if (frame.from + frame.text.length <= have) return
    if (frame.from > have) {
      this.resync()
      return
    }
    const text = frame.text.slice(have - frame.from)
    open.have.set(frame.block, have + text.length)
    this.emit({
      type: 'delta',
      id: this.args.id,
      key: frame.key,
      block: frame.block,
      kind: frame.kind,
      from: have,
      text,
    })
  }

  private handleStepEnd(frame: Extract<LiveFrame, { type: 'step-end' }>): void {
    this.retired.retire(frame.key)
    if (this.open !== undefined && sameStep(this.open.key, frame.key)) this.open = undefined
    this.emit({ type: 'frame', id: this.args.id, frame })
  }

  private async join(): Promise<void> {
    this.queued ??= []
    for (;;) {
      this.rejoin = false
      try {
        const folded = foldLiveBuffer(await this.args.readBuffer())
        if (this.stopped) return
        this.applySnapshot(folded)
      } catch (error) {
        this.args.log?.error({
          source: 'stream',
          message: 'reading the live buffer failed',
          ...logFieldsOf({ error }),
        })
      }
      if (this.stopped) return
      if (!this.rejoin) break
    }
    const replay = this.queued ?? []
    this.queued = undefined
    for (const frame of replay) this.handleFrame(frame)
  }

  private applySnapshot(folded: FoldedStep | undefined): void {
    const open = this.open
    if (folded === undefined || this.retired.has(folded.key)) {
      if (open === undefined) return
      this.retired.retire(open.key)
      this.open = undefined
      this.emit({ type: 'overlay-clear', id: this.args.id, reason: EStreamClearReason.Lost })
      return
    }
    if (open !== undefined && !sameStep(open.key, folded.key)) {
      this.retired.retireBefore({ previous: open.key, next: folded.key })
    }
    if (folded.end !== undefined) {
      this.retired.retire(folded.key)
      this.open = undefined
      if (open !== undefined) {
        this.emit({
          type: 'frame',
          id: this.args.id,
          frame: { type: 'step-end', key: folded.key, reason: folded.end },
        })
      }
      return
    }
    this.open = {
      key: folded.key,
      have: new Map(folded.blocks.map((block) => [block.block, block.text.length])),
    }
    this.emit({ type: 'overlay', id: this.args.id, key: folded.key, blocks: folded.blocks })
  }

  private overloaded(): boolean {
    return this.args.bufferedAmount() >= FOLLOW_HIGH_WATER_BYTES
  }

  private emit(message: StreamServerMessage): void {
    if (this.overloaded()) {
      this.stale = true
      return
    }
    this.args.send(message)
  }
}
