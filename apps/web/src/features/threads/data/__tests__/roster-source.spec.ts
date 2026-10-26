import { describe, expect, test } from 'bun:test'

import { EClientRequest } from '@dltech/atlas-client/channel'
import type { RosterWire } from '@dltech/atlas-wire/web'

import { subscribeRoster, type RosterChannel } from '../roster-source'

const EMPTY: RosterWire = { shells: [], agents: [], services: [] }

function fakeChannel(reply: unknown) {
  const listeners: Array<(roster: RosterWire) => void> = []
  const requests: EClientRequest[] = []
  const channel: RosterChannel = {
    request: async ({ op }) => {
      requests.push(op)
      return reply
    },
    onRoster: (listener) => {
      listeners.push(listener)
      return () => listeners.splice(listeners.indexOf(listener), 1)
    },
  }
  const push = (roster: RosterWire) => {
    for (const listener of [...listeners]) listener(roster)
  }
  return { channel, requests, push, listenerCount: () => listeners.length }
}

describe('subscribeRoster', () => {
  test('asks for the current roster and delivers the reply', async () => {
    const fake = fakeChannel(EMPTY)
    const seen: RosterWire[] = []
    subscribeRoster({ channel: fake.channel, onRoster: (roster) => seen.push(roster) })
    await Bun.sleep(0)
    expect(fake.requests).toEqual([EClientRequest.ListRoster])
    expect(seen).toEqual([EMPTY])
  })

  test('ignores a reply that is not a roster', async () => {
    const fake = fakeChannel({ nope: true })
    const seen: RosterWire[] = []
    subscribeRoster({ channel: fake.channel, onRoster: (roster) => seen.push(roster) })
    await Bun.sleep(0)
    expect(seen).toEqual([])
  })

  test('forwards pushed rosters until unsubscribed', async () => {
    const fake = fakeChannel(null)
    const seen: RosterWire[] = []
    const stop = subscribeRoster({ channel: fake.channel, onRoster: (roster) => seen.push(roster) })
    fake.push(EMPTY)
    stop()
    fake.push(EMPTY)
    await Bun.sleep(0)
    expect(seen).toEqual([EMPTY])
    expect(fake.listenerCount()).toBe(0)
  })
})
