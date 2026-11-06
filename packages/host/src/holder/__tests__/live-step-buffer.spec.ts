import { beforeEach, describe, expect, it } from 'bun:test'

import { EStepEndReason } from '@dltech/atlas-core'
import { EStreamBlockKind, type LiveFrame } from '@dltech/atlas-protocol'

import {
  LIVE_FLUSH_BYTES,
  LIVE_FLUSH_MS,
  LIVE_STEP_CAP_BYTES,
  LiveStepBuffer,
} from '../live-step-buffer'
import { FakeClock } from './rig-fakes'

const key = { runId: 'run-1', step: 0, attempt: 0 }

describe('LiveStepBuffer', () => {
  let clock: FakeClock
  let frames: LiveFrame[]
  let buffer: LiveStepBuffer
  let head: number

  const text = (args: { id: string; text: string; reasoning?: boolean }) =>
    buffer.push({
      type: 'chunk',
      key,
      chunk: { type: args.reasoning === true ? 'reasoning-delta' : 'text-delta', ...args },
    })

  const deltas = () => frames.flatMap((frame) => (frame.type === 'delta' ? [frame] : []))

  beforeEach(() => {
    clock = new FakeClock()
    frames = []
    head = 7
    buffer = new LiveStepBuffer({
      timers: clock,
      emit: async (frame) => {
        frames.push(frame)
      },
      headSeq: () => head,
    })
    buffer.push({ type: 'step-start', key })
  })

  it('emits step-start itself', () => {
    expect(frames).toEqual([{ type: 'step-start', key, afterSeq: 7 }])
  })

  it('flushes the first delta of a step at once', () => {
    text({ id: 'b1', text: 'He' })
    expect(deltas()).toEqual([
      { type: 'delta', key, block: 'b1', kind: EStreamBlockKind.Text, from: 0, text: 'He' },
    ])
  })

  it('coalesces later text until LIVE_FLUSH_MS has passed', () => {
    text({ id: 'b1', text: 'He' })
    clock.advance(10)
    text({ id: 'b1', text: 'll' })
    text({ id: 'b1', text: 'o' })
    expect(deltas()).toHaveLength(1)
    clock.advance(LIVE_FLUSH_MS - 10 - 1)
    expect(deltas()).toHaveLength(1)
    clock.advance(1)
    expect(deltas().map((frame) => [frame.from, frame.text])).toEqual([
      [0, 'He'],
      [2, 'llo'],
    ])
  })

  it('flushes when LIVE_FLUSH_BYTES are pending', () => {
    text({ id: 'b1', text: 'x' })
    text({ id: 'b1', text: 'y'.repeat(LIVE_FLUSH_BYTES) })
    expect(deltas()).toHaveLength(2)
    expect(deltas()[1]?.from).toBe(1)
  })

  it('tracks offsets per block, in UTF-16 units', () => {
    text({ id: 'b1', text: 'a😀' })
    text({ id: 'r1', text: 'think', reasoning: true })
    clock.advance(LIVE_FLUSH_MS)
    text({ id: 'b1', text: 'z' })
    clock.advance(LIVE_FLUSH_MS)
    expect(deltas().map((frame) => [frame.block, frame.kind, frame.from, frame.text])).toEqual([
      ['b1', 'text', 0, 'a😀'],
      ['r1', 'reasoning', 0, 'think'],
      ['b1', 'text', 3, 'z'],
    ])
  })

  it('flushes pending text before step-end and then emits it', () => {
    text({ id: 'b1', text: 'He' })
    text({ id: 'b1', text: 'llo' })
    buffer.push({ type: 'step-end', key, reason: EStepEndReason.Finished })
    expect(frames.slice(-2)).toEqual([
      { type: 'delta', key, block: 'b1', kind: EStreamBlockKind.Text, from: 2, text: 'llo' },
      { type: 'step-end', key, reason: EStepEndReason.Finished },
    ])
    expect(clock.pendingCount()).toBe(0)
  })

  it('stops emitting deltas past LIVE_STEP_CAP_BYTES', () => {
    const piece = 'p'.repeat(LIVE_FLUSH_BYTES)
    for (let sent = 0; sent < LIVE_STEP_CAP_BYTES + 4 * piece.length; sent += piece.length) {
      text({ id: 'b1', text: piece })
    }
    buffer.push({ type: 'step-end', key, reason: EStepEndReason.Finished })
    const total = deltas().reduce((sum, frame) => sum + frame.text.length, 0)
    expect(total).toBeLessThanOrEqual(LIVE_STEP_CAP_BYTES)
    expect(total).toBeGreaterThan(LIVE_STEP_CAP_BYTES - piece.length)
    expect(frames.at(-1)?.type).toBe('step-end')
  })

  it('resets per-block lengths on a new step-start', () => {
    text({ id: 'b1', text: 'abc' })
    buffer.push({ type: 'step-end', key, reason: EStepEndReason.Finished })
    const next = { runId: 'run-1', step: 0, attempt: 1 }
    buffer.push({ type: 'step-start', key: next })
    buffer.push({ type: 'chunk', key: next, chunk: { type: 'text-delta', id: 'b1', text: 'xy' } })
    expect(deltas().at(-1)).toEqual({
      type: 'delta',
      key: next,
      block: 'b1',
      kind: EStreamBlockKind.Text,
      from: 0,
      text: 'xy',
    })
  })

  it('treats the first delta of the next step as immediate again', () => {
    text({ id: 'b1', text: 'abc' })
    buffer.push({ type: 'step-end', key, reason: EStepEndReason.Finished })
    const next = { runId: 'run-1', step: 5, attempt: 0 }
    buffer.push({ type: 'step-start', key: next })
    const before = frames.length
    buffer.push({ type: 'chunk', key: next, chunk: { type: 'text-delta', id: 'b2', text: 'q' } })
    expect(frames.length).toBe(before + 1)
  })

  it('stays capped after the first chunk that overflows, so the overlay is a prefix', () => {
    text({ id: 'b1', text: 'a'.repeat(LIVE_STEP_CAP_BYTES - 1) })
    text({ id: 'b1', text: 'XY' })
    text({ id: 'b1', text: 'z' })
    clock.advance(LIVE_FLUSH_MS)
    const sent = deltas()
      .map((frame) => frame.text)
      .join('')
    expect(sent).toBe('a'.repeat(LIVE_STEP_CAP_BYTES - 1))
  })

  it('a new step-start flushes the previous step and its old timer never fires later', () => {
    text({ id: 'b1', text: 'A' })
    text({ id: 'b1', text: 'B' })
    const next = { runId: 'run-1', step: 1, attempt: 0 }
    buffer.push({ type: 'step-start', key: next })
    clock.advance(LIVE_FLUSH_MS * 3)
    const old = deltas().filter((frame) => frame.key.step === 0)
    expect(old.map((frame) => frame.text).join('')).toBe('AB')
    expect(deltas().filter((frame) => frame.key.step === 1)).toEqual([])
    expect(frames.at(-1)).toEqual({ type: 'step-start', key: next, afterSeq: head })
  })

  describe('when a publish fails', () => {
    let delivered: LiveFrame[]
    let failNext: number

    const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0))

    const readerText = () => {
      const blocks = new Map<string, string>()
      for (const frame of delivered) {
        if (frame.type === 'step-start') blocks.clear()
        if (frame.type !== 'delta') continue
        const have = blocks.get(frame.block) ?? ''
        if (frame.from > have.length) continue
        blocks.set(frame.block, have + frame.text.slice(have.length - frame.from))
      }
      return blocks.get('b1')
    }

    beforeEach(() => {
      delivered = []
      failNext = 0
      frames = []
      buffer = new LiveStepBuffer({
        timers: clock,
        emit: async (frame) => {
          frames.push(frame)
          if (failNext > 0) {
            failNext -= 1
            throw new Error('redis down')
          }
          delivered.push(frame)
        },
        headSeq: () => head,
      })
      buffer.push({ type: 'step-start', key })
    })

    it('re-sends step-start with the original afterSeq and the full text from 0', async () => {
      text({ id: 'b1', text: 'He' })
      await flushMicrotasks()
      failNext = 1
      clock.advance(LIVE_FLUSH_MS)
      text({ id: 'b1', text: 'llo' })
      await flushMicrotasks()
      head = 99
      text({ id: 'b1', text: ' wor' })
      clock.advance(LIVE_FLUSH_MS)
      await flushMicrotasks()
      clock.advance(LIVE_FLUSH_MS)
      await flushMicrotasks()
      const tail = frames.slice(-2)
      expect(tail[0]).toEqual({ type: 'step-start', key, afterSeq: 7 })
      expect(tail[1]).toEqual({
        type: 'delta',
        key,
        block: 'b1',
        kind: EStreamBlockKind.Text,
        from: 0,
        text: 'Hello wor',
      })
      expect(readerText()).toBe('Hello wor')
    })

    it('keeps resyncing until a publish lands', async () => {
      failNext = 1
      text({ id: 'b1', text: 'ab' })
      await flushMicrotasks()
      failNext = 2
      clock.advance(LIVE_FLUSH_MS)
      await flushMicrotasks()
      clock.advance(LIVE_FLUSH_MS)
      await flushMicrotasks()
      clock.advance(LIVE_FLUSH_MS)
      await flushMicrotasks()
      expect(readerText()).toBe('ab')
    })

    it('ignores a failure for a step that is no longer current', async () => {
      failNext = 1
      text({ id: 'b1', text: 'ab' })
      buffer.push({ type: 'step-end', key, reason: EStepEndReason.Finished })
      await flushMicrotasks()
      const before = frames.length
      clock.advance(LIVE_FLUSH_MS * 5)
      await flushMicrotasks()
      expect(frames.length).toBe(before)
      expect(clock.pendingCount()).toBe(0)
    })
  })
})
