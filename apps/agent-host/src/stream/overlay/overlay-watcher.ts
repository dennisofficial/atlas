import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import {
  EStreamClearReason,
  type LiveFrame,
  type StreamServerMessage,
  type StreamStepKey,
} from '@dltech/atlas-protocol'

import { FOLLOW_HIGH_WATER_BYTES } from '../follow-limits'
import { foldLiveBuffer, type FoldedStep } from './fold-live-buffer'
import { isLaterInRun, RetiredSteps, sameStep } from './step-order'

export const OVERLAY_QUEUE_BYTES = 256 * 1024

type StepFrame = Extract<LiveFrame, { type: 'step-start' | 'delta' | 'step-end' }>

type OpenStep = { key: StreamStepKey; have: Map<string, number> }

type Queued = { frame: LiveFrame; size: number }

type Queue = { items: Queued[]; bytes: number }

export type OverlayWatcherArgs = {
  id: string
  send(message: StreamServerMessage): void
  bufferedAmount(): number
  readBuffer(): Promise<string | null>
  isLive(): boolean
  log: LogPort | undefined
}

const isStepFrame = (frame: LiveFrame): frame is StepFrame =>
  frame.type === 'step-start' || frame.type === 'delta' || frame.type === 'step-end'

const isEarlierInSameRun = (args: { candidate: StreamStepKey; current: StreamStepKey }): boolean =>
  args.candidate.runId === args.current.runId &&
  !sameStep({ left: args.candidate, right: args.current }) &&
  !isLaterInRun(args)

const lastStartOf = (args: { items: readonly Queued[]; key: StreamStepKey }): number =>
  args.items.findLastIndex(
    ({ frame }) => frame.type === 'step-start' && sameStep({ left: frame.key, right: args.key }),
  )

const emptyQueue = (): Queue => ({ items: [], bytes: 0 })

export class OverlayWatcher {
  private readonly retired = new RetiredSteps()
  private open: OpenStep | undefined
  private shown: StreamStepKey | undefined
  private wanted: StreamStepKey | undefined
  private queue: Queue | undefined = emptyQueue()
  private rejoin = false
  private stale = false
  private stopped = false

  constructor(private readonly args: OverlayWatcherArgs) {}

  start(): void {
    void this.join()
  }

  resync(): void {
    if (this.queue !== undefined) {
      this.rejoin = true
      return
    }
    this.queue = emptyQueue()
    void this.join()
  }

  holderLost(): void {
    if (this.stopped) return
    if (this.open !== undefined) this.retired.retire(this.open.key)
    this.open = undefined
    if (this.queue !== undefined) {
      this.queue.items = this.queue.items.filter(({ frame }) => !isStepFrame(frame))
    }
    if (this.shown === undefined) return
    this.emit({ type: 'overlay-clear', id: this.args.id, reason: EStreamClearReason.HolderLost })
  }

  stop(): void {
    this.stopped = true
    this.queue = undefined
  }

  handleFrame(item: Queued): void {
    if (this.stopped) return
    if (this.queue !== undefined) {
      this.enqueue({ queue: this.queue, item })
      return
    }
    if (this.stale && !this.overloaded()) {
      this.stale = false
      this.queue = { items: [item], bytes: item.size }
      void this.join()
      return
    }
    this.apply(item.frame)
  }

  private enqueue(args: { queue: Queue; item: Queued }): void {
    const { queue, item } = args
    if (queue.bytes + item.size > OVERLAY_QUEUE_BYTES) {
      queue.items = []
      queue.bytes = 0
      this.rejoin = true
      return
    }
    queue.items.push(item)
    queue.bytes += item.size
  }

  private apply(frame: LiveFrame): void {
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
      if (sameStep({ left: key, right: open.key })) return
      if (isEarlierInSameRun({ candidate: key, current: open.key })) return
      this.retired.retireSuperseded({ stale: open.key, latest: key })
    }
    this.open = { key, have: new Map() }
    this.emit({ type: 'overlay', id: this.args.id, key, blocks: [] })
  }

  private handleDelta(frame: Extract<LiveFrame, { type: 'delta' }>): void {
    const open = this.open
    if (open === undefined || !sameStep({ left: open.key, right: frame.key })) {
      if (open !== undefined && isEarlierInSameRun({ candidate: frame.key, current: open.key })) {
        return
      }
      this.wanted = frame.key
      this.resync()
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
    if (this.open !== undefined && sameStep({ left: this.open.key, right: frame.key })) {
      this.open = undefined
    }
    this.emit({ type: 'frame', id: this.args.id, frame })
  }

  private async join(): Promise<void> {
    let latest: FoldedStep | undefined
    for (;;) {
      this.rejoin = false
      try {
        const folded = foldLiveBuffer(await this.args.readBuffer())
        if (this.stopped) return
        this.applySnapshot(folded)
        latest = folded
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
    const items = this.queue?.items ?? []
    this.queue = undefined
    this.replay({ items, latest })
  }

  private replay(args: { items: readonly Queued[]; latest: FoldedStep | undefined }): void {
    const { items, latest } = args
    const cut = latest === undefined ? -1 : lastStartOf({ items, key: latest.key })
    for (const [index, item] of items.entries()) {
      if (this.stopped) return
      if (this.queue !== undefined) {
        this.enqueue({ queue: this.queue, item })
        continue
      }
      const { frame } = item
      if (latest !== undefined && index < cut && isStepFrame(frame)) {
        this.retired.retireSuperseded({ stale: frame.key, latest: latest.key })
        continue
      }
      this.apply(frame)
    }
  }

  private applySnapshot(folded: FoldedStep | undefined): void {
    const wanted = this.wanted
    this.wanted = undefined
    const open = this.open
    if (folded === undefined) {
      if (open !== undefined) this.retired.retire(open.key)
      if (wanted !== undefined) this.retired.retire(wanted)
      this.open = undefined
      this.closeShown({ folded, reason: EStreamClearReason.Lost })
      return
    }
    for (const stale of [open?.key, wanted]) {
      if (stale !== undefined) this.retired.retireSuperseded({ stale, latest: folded.key })
    }
    if (folded.end !== undefined) this.retired.retire(folded.key)
    if (this.retired.has(folded.key)) {
      this.open = undefined
      this.closeShown({ folded, reason: EStreamClearReason.Lost })
      return
    }
    if (!this.args.isLive()) {
      this.retired.retire(folded.key)
      this.open = undefined
      this.closeShown({ folded, reason: EStreamClearReason.HolderLost })
      return
    }
    this.open = {
      key: folded.key,
      have: new Map(folded.blocks.map((block) => [block.block, block.text.length])),
    }
    this.emit({ type: 'overlay', id: this.args.id, key: folded.key, blocks: folded.blocks })
  }

  private closeShown(args: { folded: FoldedStep | undefined; reason: EStreamClearReason }): void {
    const { shown } = this
    if (shown === undefined) return
    const { folded } = args
    if (folded?.end !== undefined && sameStep({ left: shown, right: folded.key })) {
      this.emit({
        type: 'frame',
        id: this.args.id,
        frame: { type: 'step-end', key: folded.key, reason: folded.end },
      })
      return
    }
    this.emit({ type: 'overlay-clear', id: this.args.id, reason: args.reason })
  }

  private overloaded(): boolean {
    return this.args.bufferedAmount() >= FOLLOW_HIGH_WATER_BYTES
  }

  private emit(message: StreamServerMessage): void {
    if (this.overloaded()) {
      this.stale = true
      return
    }
    this.track(message)
    this.args.send(message)
  }

  private track(message: StreamServerMessage): void {
    if (message.type === 'overlay') this.shown = message.key
    if (message.type === 'overlay-clear') this.shown = undefined
    if (message.type !== 'frame' || message.frame.type !== 'step-end') return
    if (this.shown !== undefined && sameStep({ left: this.shown, right: message.frame.key })) {
      this.shown = undefined
    }
  }
}
