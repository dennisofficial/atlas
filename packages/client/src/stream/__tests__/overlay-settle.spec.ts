import { describe, expect, it } from 'bun:test'
import {
  EStreamBlockKind,
  type StreamServerMessage,
  type StreamStepKey,
} from '@dltech/atlas-protocol'

import {
  applyOverlayMessage,
  closeOverlayForEvents,
  EMPTY_OVERLAY_STATE,
  endOverlay,
  settleOverlay,
  type OverlayState,
} from '../overlay-store'
import { mintEvents } from './support'

type OverlayMessage = Extract<
  StreamServerMessage,
  { type: 'overlay' | 'delta' | 'overlay-clear' | 'frame' }
>

const key = (runId: string, step: number, attempt = 0): StreamStepKey => ({ runId, step, attempt })

const overlay = (params: { key: StreamStepKey; text: string }): OverlayMessage => ({
  type: 'overlay',
  id: 's1',
  key: params.key,
  blocks: [{ block: 'b0', kind: EStreamBlockKind.Text, text: params.text }],
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

const run = (messages: readonly OverlayMessage[]) => {
  let state: OverlayState = EMPTY_OVERLAY_STATE
  for (const message of messages)
    state = applyOverlayMessage({ state, message, cursorSeq: 0 }).state
  return { state }
}

const textOf = (state: OverlayState): string | undefined =>
  state.open?.blocks.map((block) => block.text).join('|')

describe('closeOverlayForEvents by step', () => {
  const open = (step: number): OverlayState =>
    run([overlay({ key: key('run-1', step), text: 'Hel' })]).state
  const reply = (step?: number) =>
    mintEvents({
      bodies: [
        {
          type: 'assistant-said',
          parts: [{ type: 'text', text: 'x' }],
          ...(step === undefined ? {} : { step }),
        },
      ],
      runId: 'run-1',
    })

  it('keeps step 1 open for the durable reply of step 0', () => {
    expect(closeOverlayForEvents({ state: open(1), events: reply(0) }).open).toBeDefined()
  })

  it('closes on the reply of its own step and of a later one', () => {
    expect(closeOverlayForEvents({ state: open(1), events: reply(1) }).open).toBeUndefined()
    expect(closeOverlayForEvents({ state: open(1), events: reply(2) }).open).toBeUndefined()
  })

  it('closes on a reply that carries no step', () => {
    expect(closeOverlayForEvents({ state: open(1), events: reply() }).open).toBeUndefined()
  })

  it('closes an ended overlay on its durable reply', () => {
    const ended = endOverlay({ state: open(1), settleAt: undefined })
    expect(closeOverlayForEvents({ state: ended, events: reply(1) }).open).toBeUndefined()
  })
})

describe('an ended overlay settling by cursor', () => {
  const ended = (): OverlayState =>
    endOverlay({
      state: run([overlay({ key: key('run-1', 1), text: 'Hel' })]).state,
      settleAt: 7,
    })

  it('keeps the text and marks it ended', () => {
    expect(textOf(ended())).toBe('Hel')
    expect(ended().open?.ended).toBe(true)
  })

  it('keeps it until the cursor reaches the view position', () => {
    expect(settleOverlay({ state: ended(), cursorSeq: 6 }).open).toBeDefined()
  })

  it('drops it once the cursor reaches the view position with no reply', () => {
    expect(settleOverlay({ state: ended(), cursorSeq: 7 }).open).toBeUndefined()
  })

  it('drops late deltas of the ended step', () => {
    const late = applyOverlayMessage({
      state: ended(),
      cursorSeq: 0,
      message: delta({ key: key('run-1', 1), from: 3, text: 'lo' }),
    })
    expect(textOf(late.state)).toBe('Hel')
    expect(late.needsResnap).toBe(false)
  })

  it('never settles a live overlay', () => {
    const live = run([overlay({ key: key('run-1', 1), text: 'Hel' })]).state
    expect(settleOverlay({ state: live, cursorSeq: 99 }).open).toBeDefined()
  })

  it('leaves a state with nothing open alone', () => {
    expect(endOverlay({ state: EMPTY_OVERLAY_STATE, settleAt: 3 })).toBe(EMPTY_OVERLAY_STATE)
  })
})
