import { describe, expect, it } from 'bun:test'

import { EClientRequest, RemoteRequestFailed } from '@dltech/atlas-client/channel'
import type { SubscriptionsWire } from '@dltech/atlas-wire/web'

import { watchSubscriptions, type SubscriptionsChannel } from '../subscriptions-source'

const EMPTY: SubscriptionsWire = { subscriptions: [], providers: [] }

function fakeChannel(answer: () => unknown) {
  const pushes = new Set<(set: SubscriptionsWire) => void>()
  const channel: SubscriptionsChannel = {
    request: async () => answer(),
    onSubscriptions: (listener) => {
      pushes.add(listener)
      return () => void pushes.delete(listener)
    },
    onReload: () => () => undefined,
    onReady: () => () => undefined,
  }
  return {
    channel,
    push: (set: SubscriptionsWire) => {
      for (const fn of pushes) fn(set)
    },
    pushes,
  }
}

describe('watchSubscriptions', () => {
  it('delivers the listed set, then pushed sets until stopped', async () => {
    const fake = fakeChannel(() => EMPTY)
    const seen: SubscriptionsWire[] = []
    const stop = watchSubscriptions({
      channel: fake.channel,
      onSet: (set) => seen.push(set),
      onUnsupported: () => undefined,
    })
    await Bun.sleep(0)
    fake.push(EMPTY)
    stop()
    fake.push(EMPTY)

    expect(seen).toHaveLength(2)
    expect(fake.pushes.size).toBe(0)
  })

  it('reports an unsupported serve when it refuses the list', async () => {
    const fake = fakeChannel(() => {
      throw new RemoteRequestFailed({ op: EClientRequest.ListSubscriptions, data: {} })
    })
    let unsupported = 0
    watchSubscriptions({
      channel: fake.channel,
      onSet: () => undefined,
      onUnsupported: () => void (unsupported += 1),
    })
    await Bun.sleep(0)

    expect(unsupported).toBe(1)
  })
})
