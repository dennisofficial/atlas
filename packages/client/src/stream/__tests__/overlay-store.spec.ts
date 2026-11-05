import { describe, expect, it } from 'bun:test'
import {
  EStreamBlockKind,
  EStreamClearReason,
  type StreamServerMessage,
  type StreamStepKey,
} from '@dltech/atlas-protocol'
import { ERunFailureKind, EStepEndReason } from '@dltech/atlas-core'

import {
  applyOverlayMessage,
  closeOverlayForEvents,
  EMPTY_OVERLAY_STATE,
  type OverlayState,
} from '../overlay-store'
import { mintEvents } from './support'

type OverlayMessage = Extract<
  StreamServerMessage,
  { type: 'overlay' | 'delta' | 'overlay-clear' | 'frame' }
>

const key = (runId: string, step: number, attempt = 0): StreamStepKey => ({ runId, step, attempt })

const overlay = (params: { key: StreamStepKey; text?: string }): OverlayMessage => ({
  type: 'overlay',
  id: 's1',
  key: params.key,
  afterSeq: 0,
  blocks:
    params.text === undefined
      ? []
      : [{ block: 'b0', kind: EStreamBlockKind.Text, text: params.text }],
})

const delta = (params: { key: StreamStepKey; from: number; text: string }): OverlayMessage => ({
  type: 'delta',
  id: 's1',
  key: params.key,
  block: 'b0',
  kind: EStreamBlockKind.Text,
  from: params.from,
  text: params.text,
})

const stepEnd = (stepKey: StreamStepKey): OverlayMessage => ({
  type: 'frame',
  id: 's1',
  frame: { type: 'step-end', key: stepKey, reason: EStepEndReason.Finished },
})

const run = (messages: readonly OverlayMessage[]) => {
  let state: OverlayState = EMPTY_OVERLAY_STATE
  const resnaps: boolean[] = []
  for (const message of messages) {
    const result = applyOverlayMessage({ state, message })
    state = result.state
    resnaps.push(result.needsResnap)
  }
  return { state, resnaps }
}

const textOf = (state: OverlayState): string | undefined =>
  state.open?.blocks.map((block) => block.text).join('|')

describe('applyOverlayMessage', () => {
  it('replaces the overlay on an overlay message and appends deltas at their offset', () => {
    const { state } = run([
      overlay({ key: key('run-1', 1), text: 'Hel' }),
      delta({ key: key('run-1', 1), from: 3, text: 'lo' }),
    ])
    expect(textOf(state)).toBe('Hello')
    const replaced = applyOverlayMessage({
      state,
      message: overlay({ key: key('run-1', 1), text: 'Hello wor' }),
    }).state
    expect(textOf(replaced)).toBe('Hello wor')
  })

  it('opens an empty overlay for step-start', () => {
    const { state } = run([overlay({ key: key('run-1', 1) })])
    expect(state.open?.key).toEqual(key('run-1', 1))
    expect(state.open?.blocks).toEqual([])
  })

  it('drops a delta it already has and trims a partial overlap', () => {
    const { state, resnaps } = run([
      overlay({ key: key('run-1', 1), text: 'Hello' }),
      delta({ key: key('run-1', 1), from: 0, text: 'Hel' }),
      delta({ key: key('run-1', 1), from: 3, text: 'lo wor' }),
    ])
    expect(textOf(state)).toBe('Hello wor')
    expect(resnaps).toEqual([false, false, false])
  })

  it('asks for a resnap once on a gap and leaves the text alone', () => {
    const { state, resnaps } = run([
      overlay({ key: key('run-1', 1), text: 'Hel' }),
      delta({ key: key('run-1', 1), from: 9, text: 'x' }),
      delta({ key: key('run-1', 1), from: 10, text: 'y' }),
    ])
    expect(textOf(state)).toBe('Hel')
    expect(resnaps).toEqual([false, true, false])
  })

  it('asks for a resnap again once a snapshot has arrived and a new gap opens', () => {
    const { resnaps } = run([
      overlay({ key: key('run-1', 1), text: 'Hel' }),
      delta({ key: key('run-1', 1), from: 9, text: 'x' }),
      overlay({ key: key('run-1', 1), text: 'Hello' }),
      delta({ key: key('run-1', 1), from: 40, text: 'x' }),
    ])
    expect(resnaps).toEqual([false, true, false, true])
  })

  it('asks for a resnap when a delta arrives for a step it never saw open', () => {
    const { state, resnaps } = run([delta({ key: key('run-1', 2), from: 4, text: 'late' })])
    expect(state.open).toBeUndefined()
    expect(resnaps).toEqual([true])
  })

  it('drops the overlay on overlay-clear and ignores later deltas of that step', () => {
    const { state, resnaps } = run([
      overlay({ key: key('run-1', 1), text: 'Hel' }),
      { type: 'overlay-clear', id: 's1', reason: EStreamClearReason.HolderLost },
      delta({ key: key('run-1', 1), from: 3, text: 'lo' }),
    ])
    expect(state.open).toBeUndefined()
    expect(resnaps).toEqual([false, false, false])
  })

  it('keeps the text on a step-end frame, marks it ended and drops its later deltas', () => {
    const { state, resnaps } = run([
      overlay({ key: key('run-1', 1), text: 'Hel' }),
      stepEnd(key('run-1', 1)),
      delta({ key: key('run-1', 1), from: 3, text: 'lo' }),
      overlay({ key: key('run-1', 1), text: 'Hello' }),
    ])
    expect(textOf(state)).toBe('Hel')
    expect(state.open?.ended).toBe(true)
    expect(resnaps).toEqual([false, false, false, false])
  })

  it('opens a live overlay that is not ended', () => {
    const { state } = run([overlay({ key: key('run-1', 1), text: 'Hel' })])
    expect(state.open?.ended).toBe(false)
  })

  it('drops an ended overlay when a later step opens', () => {
    const { state } = run([
      overlay({ key: key('run-1', 1), text: 'one' }),
      stepEnd(key('run-1', 1)),
      overlay({ key: key('run-1', 2), text: 'two' }),
    ])
    expect(textOf(state)).toBe('two')
    expect(state.open?.ended).toBe(false)
  })

  it('drops an ended overlay on overlay-clear', () => {
    const { state } = run([
      overlay({ key: key('run-1', 1), text: 'one' }),
      stepEnd(key('run-1', 1)),
      { type: 'overlay-clear', id: 's1', reason: EStreamClearReason.HolderLost },
    ])
    expect(state.open).toBeUndefined()
  })

  it('accepts a later step or a later attempt past the high-water mark', () => {
    const { state } = run([
      overlay({ key: key('run-1', 2), text: 'two' }),
      stepEnd(key('run-1', 2)),
      overlay({ key: key('run-1', 2, 1), text: 'retry' }),
    ])
    expect(textOf(state)).toBe('retry')
    const next = applyOverlayMessage({
      state,
      message: overlay({ key: key('run-1', 3), text: 'three' }),
    }).state
    expect(textOf(next)).toBe('three')
  })

  it('retires the whole earlier run when a later run opens a step', () => {
    const { state } = run([
      overlay({ key: key('run-1', 5), text: 'old' }),
      overlay({ key: key('run-2', 0), text: 'new' }),
      delta({ key: key('run-1', 6), from: 3, text: '!' }),
    ])
    expect(state.open?.key).toEqual(key('run-2', 0))
    expect(textOf(state)).toBe('new')
  })

  it('ignores a stale earlier step of the open run', () => {
    const { state } = run([
      overlay({ key: key('run-1', 3), text: 'three' }),
      overlay({ key: key('run-1', 2), text: 'two' }),
    ])
    expect(textOf(state)).toBe('three')
  })

  it('leaves the state untouched for frames that are not step frames', () => {
    const { state } = run([
      overlay({ key: key('run-1', 1), text: 'Hel' }),
      { type: 'frame', id: 's1', frame: { type: 'tool-output', callId: 'c', text: 'x' } },
    ])
    expect(textOf(state)).toBe('Hel')
  })
})

describe('closeOverlayForEvents', () => {
  const open = (): OverlayState => run([overlay({ key: key('run-1', 1), text: 'Hel' })]).state

  it('closes the overlay when a durable assistant-said of the same run lands', () => {
    const events = mintEvents({
      bodies: [{ type: 'assistant-said', parts: [{ type: 'text', text: 'Hello' }] }],
      runId: 'run-1',
    })
    const closed = closeOverlayForEvents({ state: open(), events })
    expect(closed.open).toBeUndefined()
    const late = applyOverlayMessage({
      state: closed,
      message: delta({ key: key('run-1', 1), from: 3, text: 'lo' }),
    })
    expect(late.state.open).toBeUndefined()
    expect(late.needsResnap).toBe(false)
  })

  it('closes the overlay when a durable run-failed of the same run lands', () => {
    const events = mintEvents({
      bodies: [{ type: 'run-failed', failure: { kind: ERunFailureKind.Other, message: 'boom' } }],
      runId: 'run-1',
    })
    expect(closeOverlayForEvents({ state: open(), events }).open).toBeUndefined()
  })

  it('keeps the overlay for another run and for unrelated events', () => {
    const other = mintEvents({
      bodies: [{ type: 'assistant-said', parts: [{ type: 'text', text: 'x' }] }],
      runId: 'run-9',
    })
    const user = mintEvents({ bodies: [{ type: 'user-said', text: 'hi' }], runId: 'run-1' })
    expect(closeOverlayForEvents({ state: open(), events: other }).open).toBeDefined()
    expect(closeOverlayForEvents({ state: open(), events: user }).open).toBeDefined()
  })
})
