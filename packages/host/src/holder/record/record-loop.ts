import {
  initialLoopState,
  isVisible,
  loopStateOf,
  stepLoopState,
  toLoopEvent,
  type Event,
  type LoopState,
  type RecordEvent,
  type VisibilityState,
} from '@dltech/atlas-core'

import { firstIndexAfter } from './seq-index'

export class RecordLoopEvents {
  private sources: RecordEvent[] = []
  private loops: Event[] = []
  private handedOut = false
  private loopState: LoopState = initialLoopState()

  reset(): void {
    this.sources = []
    this.loops = []
    this.handedOut = false
    this.loopState = initialLoopState()
  }

  add(args: { event: RecordEvent; resolved: RecordEvent }): void {
    const loop = toLoopEvent({ event: args.resolved })
    if (loop === undefined) return
    if (this.handedOut) {
      this.loops = this.loops.slice()
      this.handedOut = false
    }
    this.sources.push(args.event)
    this.loops.push(loop)
    this.loopState = stepLoopState(this.loopState, loop)
  }

  dropHidden(visibility: VisibilityState): void {
    const sources: RecordEvent[] = []
    const loops: Event[] = []
    for (const [index, source] of this.sources.entries()) {
      const loop = this.loops[index]
      if (loop === undefined || !isVisible(visibility, source)) continue
      sources.push(source)
      loops.push(loop)
    }
    this.sources = sources
    this.loops = loops
    this.handedOut = false
    this.loopState = loopStateOf({ events: loops })
  }

  handOut(): Event[] {
    this.handedOut = true
    return this.loops
  }

  after(seq: number): Event[] {
    return this.loops.slice(firstIndexAfter({ items: this.loops, seq }))
  }

  state(): LoopState {
    return this.loopState
  }
}
