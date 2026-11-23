import { describe, expect, it } from 'bun:test'

import type { ThreadId } from '@dltech/atlas-core'
import type { ChannelListener, ChannelSignal } from '@dltech/atlas-client/channel'
import { createDeltaChannel } from '@dltech/atlas-harness'
import { fixtureThreadId } from '@dltech/atlas-client/transcript-fixture'

import { channelSignalFeed } from '../channel-signal-feed'

const textsOf = (signals: readonly ChannelSignal[]): string[] =>
  signals.flatMap((signal) =>
    signal.type === 'chunk' && signal.chunk.type === 'text-delta' ? [signal.chunk.text] : [],
  )

describe('the channel signal feed', () => {
  it('subscribes on the thread it was built for', () => {
    const subscriptions: { threadId: ThreadId; listener: ChannelListener }[] = []
    const channel = {
      subscribe: (args: { threadId: ThreadId; listener: ChannelListener }) => {
        subscriptions.push(args)
        return () => undefined
      },
    }

    channelSignalFeed({ channel, threadId: fixtureThreadId }).subscribe(() => undefined)

    expect(subscriptions.map((args) => args.threadId)).toEqual([fixtureThreadId])
  })

  it('hands the listener its thread signals until it unsubscribes', () => {
    const channel = createDeltaChannel()
    const signals: ChannelSignal[] = []
    const unsubscribe = channelSignalFeed({ channel, threadId: fixtureThreadId }).subscribe(
      (signal) => void signals.push(signal),
    )
    const publisher = channel.publisherFor({ threadId: fixtureThreadId })

    publisher.onChunk({ type: 'text-delta', id: 'b1', text: 'kept' })
    unsubscribe()
    publisher.onChunk({ type: 'text-delta', id: 'b1', text: 'dropped' })

    expect(textsOf(signals)).toEqual(['kept'])
  })
})
