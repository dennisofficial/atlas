import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { createDeltaChannel, type ChannelSignal } from '..'
import { recorder } from './signals'

const threadId = toThreadId('held-thread')

const workingsOf = (seen: readonly ChannelSignal[]): boolean[] =>
  seen.flatMap((signal) => (signal.type === 'turn-working' ? [signal.working] : []))

describe('holding a thread working across the loop', () => {
  it('announces working the moment the hold is taken', () => {
    const channel = createDeltaChannel()
    const { seen, listener } = recorder()
    channel.subscribe({ threadId, listener })

    channel.publisherFor({ threadId }).holdWorking()

    expect(seen).toEqual([{ type: 'turn-working', working: true }])
    expect(channel.snapshot({ threadId })).toEqual([{ type: 'turn-working', working: true }])
  })

  it('keeps working through the loop going idle between passes', () => {
    const channel = createDeltaChannel()
    const { seen, listener } = recorder()
    channel.subscribe({ threadId, listener })
    const publisher = channel.publisherFor({ threadId })

    const release = publisher.holdWorking()
    publisher.turnWorking({ working: true })
    publisher.turnWorking({ working: false })
    publisher.turnWorking({ working: true })
    publisher.turnWorking({ working: false })

    expect(workingsOf(seen)).toEqual([true])

    release()

    expect(workingsOf(seen)).toEqual([true, false])
    expect(channel.snapshot({ threadId })).toEqual([])
  })

  it('stays working when released while the loop still runs', () => {
    const channel = createDeltaChannel()
    const { seen, listener } = recorder()
    channel.subscribe({ threadId, listener })
    const publisher = channel.publisherFor({ threadId })

    const release = publisher.holdWorking()
    publisher.turnWorking({ working: true })
    release()
    release()

    expect(workingsOf(seen)).toEqual([true])

    publisher.turnWorking({ working: false })

    expect(workingsOf(seen).at(-1)).toBe(false)
  })
})
