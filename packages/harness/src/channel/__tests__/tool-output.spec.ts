import { describe, expect, it } from 'bun:test'

import { toCallId, toThreadId } from '@dltech/atlas-core'

import { createDeltaChannel } from '..'
import { recorder } from './signals'

const threadId = toThreadId('thread-1')
const callId = toCallId('call-1')

describe('tool output between steps', () => {
  it('publishes each chunk keyed by the call that printed it, stamped with no step', () => {
    const channel = createDeltaChannel()
    const { seen, listener } = recorder()
    channel.subscribe({ threadId, listener })
    const publisher = channel.publisherFor({ threadId })

    publisher.toolOutput({ callId, text: 'compiling\n' })
    publisher.toolOutput({ callId: toCallId('call-2'), text: 'linking\n' })

    expect(seen).toEqual([
      { type: 'tool-output', callId, text: 'compiling\n' },
      { type: 'tool-output', callId: toCallId('call-2'), text: 'linking\n' },
    ])
  })

  it('is part of what a late subscriber replays while it is still in flight', () => {
    const channel = createDeltaChannel()
    channel.publisherFor({ threadId }).toolOutput({ callId, text: 'compiling\n' })

    expect(channel.snapshot({ threadId })).toEqual([
      { type: 'tool-output', callId, text: 'compiling\n' },
    ])

    const late = recorder()
    channel.subscribe({ threadId, listener: late.listener })
    expect(late.seen).toEqual([{ type: 'tool-output', callId, text: 'compiling\n' }])
  })

  it('keeps only a bounded tail of a loud call replayable while delivering every chunk live', () => {
    const channel = createDeltaChannel()
    const { seen, listener } = recorder()
    channel.subscribe({ threadId, listener })
    const publisher = channel.publisherFor({ threadId })

    const chunk = 'x'.repeat(8192)
    for (let i = 0; i < 100; i++) publisher.toolOutput({ callId, text: chunk })

    expect(seen).toHaveLength(100)
    expect(seen.every((signal) => signal.type === 'tool-output' && signal.text === chunk)).toBe(true)

    const replayed = channel.snapshot({ threadId })
    const retained = replayed.reduce(
      (total, signal) => total + (signal.type === 'tool-output' ? signal.text.length : 0),
      0,
    )
    expect(retained).toBeLessThanOrEqual(60_000)

    const late = recorder()
    channel.subscribe({ threadId, listener: late.listener })
    const lateRetained = late.seen.reduce(
      (total, signal) => total + (signal.type === 'tool-output' ? signal.text.length : 0),
      0,
    )
    expect(lateRetained).toBeLessThanOrEqual(60_000)
  })

  it('trims a single oversize chunk in the replay but not in live delivery', () => {
    const channel = createDeltaChannel()
    const { seen, listener } = recorder()
    channel.subscribe({ threadId, listener })
    const publisher = channel.publisherFor({ threadId })

    const loud = 'y'.repeat(500_000)
    publisher.toolOutput({ callId, text: loud })

    expect(seen).toEqual([{ type: 'tool-output', callId, text: loud }])
    const replayed = channel.snapshot({ threadId })
    expect(replayed).toHaveLength(1)
    const tail = replayed[0]
    if (tail?.type !== 'tool-output') throw new Error('expected a tool-output replay')
    expect(tail.text.length).toBeLessThanOrEqual(60_000)
    expect(loud.endsWith(tail.text)).toBe(true)
  })

  it('bounds each call independently', () => {
    const channel = createDeltaChannel()
    const publisher = channel.publisherFor({ threadId })
    const other = toCallId('call-2')

    const chunk = 'z'.repeat(8192)
    for (let i = 0; i < 20; i++) {
      publisher.toolOutput({ callId, text: chunk })
      publisher.toolOutput({ callId: other, text: chunk })
    }

    const retained = channel
      .snapshot({ threadId })
      .filter((signal) => signal.type === 'tool-output')
    for (const id of [callId, other]) {
      const total = retained
        .filter((signal) => signal.type === 'tool-output' && signal.callId === id)
        .reduce((sum, signal) => sum + (signal.type === 'tool-output' ? signal.text.length : 0), 0)
      expect(total).toBeLessThanOrEqual(60_000)
    }
  })

  it('yields the replay to the next step once one starts, like any in-flight signal', () => {
    const channel = createDeltaChannel()
    const publisher = channel.publisherFor({ threadId })
    publisher.toolOutput({ callId, text: 'compiling\n' })

    publisher.onChunk({ type: 'text-delta', id: 't1', text: 'done' })

    expect(channel.snapshot({ threadId }).map((signal) => signal.type)).toEqual([
      'step-started',
      'chunk',
    ])
  })
})
