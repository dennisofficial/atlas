import { describe, expect, it } from 'bun:test'

import { createDeltaChannel } from '@dltech/atlas-harness'
import { fixtureThreadId } from '@dltech/atlas-client/transcript-fixture'

import { createConversationStore } from '../conversation-store'
import { EEntryKind } from '@dltech/atlas-client/transcript'

const A_FRAME_OR_TWO = 60

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const tailOf = (store: ReturnType<typeof createConversationStore>): string =>
  store
    .getSnapshot()
    .entries.filter((entry) => entry.kind !== EEntryKind.OperatorSaid)
    .map((entry) => entry.text)
    .at(-1) ?? ''

describe('the paced reveal under a fast stream', () => {
  it('never passes the reveal horizon, however fast deltas arrive', async () => {
    const channel = createDeltaChannel()
    const store = createConversationStore({
      channel,
      threadId: fixtureThreadId,
      paceReveal: true,
    })
    const publisher = channel.publisherFor({ threadId: fixtureThreadId })
    const arrived = 'x'.repeat(2_000)

    let largestJump = 0
    let last = 0
    store.subscribe(() => {
      const shown = tailOf(store).length
      largestJump = Math.max(largestJump, shown - last)
      last = shown
    })

    for (const text of arrived.match(/.{1,20}/g) ?? []) {
      publisher.onChunk({ type: 'text-delta', id: 'b1', text })
    }

    await sleep(900)

    expect(tailOf(store)).toBe(arrived)
    expect(largestJump).toBeLessThanOrEqual(arrived.length / 5)
  })
})
