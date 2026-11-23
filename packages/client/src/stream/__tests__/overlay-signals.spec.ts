import { EStreamBlockKind, type StreamStepKey } from '@dltech/atlas-protocol'
import { describe, expect, test } from 'bun:test'

import { EStepEnd, toStepId } from '../../channel'
import type { OpenOverlay, OverlayBlock } from '../overlay-store'
import { overlayRewrote, overlaySignalsOf, type OverlaySignalSource } from '../overlay-signals'

const KEY: StreamStepKey = { runId: 'run-1', step: 1, attempt: 0 }

const OTHER_KEY: StreamStepKey = { runId: 'run-1', step: 2, attempt: 0 }

const STEP_ID = toStepId('run-1:1:0')

const OTHER_STEP_ID = toStepId('run-1:2:0')

const textBlock = (args: { id: string; text: string }): OverlayBlock => ({
  block: args.id,
  kind: EStreamBlockKind.Text,
  text: args.text,
})

const overlayOf = (args: {
  blocks: readonly OverlayBlock[]
  ended?: boolean
  key?: StreamStepKey
}): OpenOverlay => ({
  key: args.key ?? KEY,
  afterSeq: 0,
  blocks: args.blocks,
  ended: args.ended ?? false,
})

const sourceOf = (args: {
  overlay?: OpenOverlay | undefined
  working?: boolean
}): OverlaySignalSource => ({
  overlay: args.overlay,
  working: args.working ?? false,
})

const stateOf = (args: { blocks: readonly OverlayBlock[]; ended?: boolean }): OverlaySignalSource =>
  sourceOf({ overlay: overlayOf({ blocks: args.blocks, ended: args.ended ?? false }) })

describe('overlaySignalsOf', () => {
  test('opens a step, then its first block, then its text', () => {
    const signals = overlaySignalsOf({
      previous: undefined,
      next: stateOf({ blocks: [textBlock({ id: 'b1', text: 'hello' })] }),
    })

    expect(signals).toEqual([
      { type: 'turn-working', working: false },
      { type: 'step-started', stepId: STEP_ID },
      { type: 'chunk', stepId: STEP_ID, chunk: { type: 'text-start', id: 'b1' } },
      { type: 'chunk', stepId: STEP_ID, chunk: { type: 'text-delta', id: 'b1', text: 'hello' } },
    ])
  })

  test('a growing block yields only the suffix', () => {
    const signals = overlaySignalsOf({
      previous: stateOf({ blocks: [textBlock({ id: 'b1', text: 'hello' })] }),
      next: stateOf({ blocks: [textBlock({ id: 'b1', text: 'hello there' })] }),
    })

    expect(signals).toEqual([
      { type: 'chunk', stepId: STEP_ID, chunk: { type: 'text-delta', id: 'b1', text: ' there' } },
    ])
  })

  test('an unchanged source yields nothing', () => {
    const source = stateOf({ blocks: [textBlock({ id: 'b1', text: 'hello' })] })

    expect(overlaySignalsOf({ previous: source, next: source })).toEqual([])
  })

  test('a new step key ends the previous step as completed', () => {
    const signals = overlaySignalsOf({
      previous: stateOf({ blocks: [textBlock({ id: 'b1', text: 'hello' })] }),
      next: sourceOf({ overlay: overlayOf({ key: OTHER_KEY, blocks: [] }) }),
    })

    expect(signals).toEqual([
      { type: 'step-ended', stepId: STEP_ID, end: EStepEnd.Completed, supersededBy: null },
      { type: 'step-started', stepId: OTHER_STEP_ID },
    ])
  })

  test('a closed overlay ends its step and starts nothing', () => {
    const signals = overlaySignalsOf({
      previous: stateOf({ blocks: [textBlock({ id: 'b1', text: 'hello' })] }),
      next: sourceOf({ overlay: undefined }),
    })

    expect(signals).toEqual([
      { type: 'step-ended', stepId: STEP_ID, end: EStepEnd.Completed, supersededBy: null },
    ])
  })

  test('an overlay that arrived ended ends its step and carries no text', () => {
    const signals = overlaySignalsOf({
      previous: stateOf({ blocks: [textBlock({ id: 'b1', text: 'hello' })] }),
      next: stateOf({ blocks: [textBlock({ id: 'b1', text: 'hello world' })], ended: true }),
    })

    expect(signals).toEqual([
      { type: 'step-ended', stepId: STEP_ID, end: EStepEnd.Completed, supersededBy: null },
    ])
  })

  test('a working flip emits turn-working', () => {
    const source = stateOf({ blocks: [textBlock({ id: 'b1', text: 'hello' })] })

    expect(overlaySignalsOf({ previous: source, next: { ...source, working: true } })).toEqual([
      { type: 'turn-working', working: true },
    ])
  })

  test('a reasoning block starts and grows as reasoning', () => {
    const block: OverlayBlock = { block: 'r1', kind: EStreamBlockKind.Reasoning, text: 'why' }
    const signals = overlaySignalsOf({ previous: undefined, next: stateOf({ blocks: [block] }) })

    expect(signals).toContainEqual({
      type: 'chunk',
      stepId: STEP_ID,
      chunk: { type: 'reasoning-start', id: 'r1' },
    })
    expect(signals).toContainEqual({
      type: 'chunk',
      stepId: STEP_ID,
      chunk: { type: 'reasoning-delta', id: 'r1', text: 'why' },
    })
  })

  test('a rewritten block emits no chunk and is reported as a rewrite', () => {
    const previous = stateOf({ blocks: [textBlock({ id: 'b1', text: 'hello' })] })
    const next = stateOf({ blocks: [textBlock({ id: 'b1', text: 'farewell' })] })

    expect(overlaySignalsOf({ previous, next })).toEqual([])
    expect(overlayRewrote({ previous, next })).toBe(true)
  })

  test('appended text is not a rewrite', () => {
    const previous = stateOf({ blocks: [textBlock({ id: 'b1', text: 'hello' })] })
    const next = stateOf({ blocks: [textBlock({ id: 'b1', text: 'hello there' })] })

    expect(overlayRewrote({ previous, next })).toBe(false)
  })

  test('a first overlay or a new key is not a rewrite', () => {
    expect(
      overlayRewrote({
        previous: undefined,
        next: stateOf({ blocks: [textBlock({ id: 'b1', text: 'hello' })] }),
      }),
    ).toBe(false)
    expect(
      overlayRewrote({
        previous: stateOf({ blocks: [textBlock({ id: 'b1', text: 'hello' })] }),
        next: sourceOf({
          overlay: overlayOf({ key: OTHER_KEY, blocks: [textBlock({ id: 'b1', text: 'other' })] }),
        }),
      }),
    ).toBe(false)
  })
})
