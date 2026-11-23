import { EStreamBlockKind, type StreamStepKey } from '@dltech/atlas-protocol'
import { describe, expect, test } from 'bun:test'

import { EStepEnd, toStepId } from '@dltech/atlas-client/channel'
import type { ChannelSignal } from '@dltech/atlas-client/channel'
import type { OverlayBlock } from '@dltech/atlas-client/stream'

import { overlaySignalFeed } from '../overlay-signal-feed'

const KEY: StreamStepKey = { runId: 'run-1', step: 1, attempt: 0 }

const STEP_ID = toStepId('run-1:1:0')

const blockOf = (text: string): OverlayBlock => ({
  block: 'b1',
  kind: EStreamBlockKind.Text,
  text,
})

describe('overlaySignalFeed', () => {
  test('a listener sees the signals of every publish, in order', () => {
    const feed = overlaySignalFeed()
    const seen: ChannelSignal[] = []
    feed.signals.subscribe((signal) => seen.push(signal))

    feed.publish({
      overlay: { key: KEY, afterSeq: 0, blocks: [blockOf('hi')], ended: false },
      working: false,
    })
    feed.publish({
      overlay: { key: KEY, afterSeq: 0, blocks: [blockOf('hi there')], ended: false },
      working: false,
    })

    expect(seen).toEqual([
      { type: 'turn-working', working: false },
      { type: 'step-started', stepId: STEP_ID },
      { type: 'chunk', stepId: STEP_ID, chunk: { type: 'text-start', id: 'b1' } },
      { type: 'chunk', stepId: STEP_ID, chunk: { type: 'text-delta', id: 'b1', text: 'hi' } },
      { type: 'chunk', stepId: STEP_ID, chunk: { type: 'text-delta', id: 'b1', text: ' there' } },
    ])
  })

  test('the second publish diffs against the first', () => {
    const feed = overlaySignalFeed()
    const seen: ChannelSignal[] = []
    feed.publish({
      overlay: { key: KEY, afterSeq: 0, blocks: [blockOf('hi')], ended: false },
      working: false,
    })

    feed.signals.subscribe((signal) => seen.push(signal))
    feed.publish({
      overlay: { key: KEY, afterSeq: 0, blocks: [blockOf('hi')], ended: true },
      working: false,
    })

    expect(seen).toEqual([
      { type: 'step-ended', stepId: STEP_ID, end: EStepEnd.Completed, supersededBy: null },
    ])
  })

  test('unsubscribing stops the signals', () => {
    const feed = overlaySignalFeed()
    const seen: ChannelSignal[] = []
    const unsubscribe = feed.signals.subscribe((signal) => seen.push(signal))

    unsubscribe()
    feed.publish({ overlay: undefined, working: true })

    expect(seen).toEqual([])
  })
})
