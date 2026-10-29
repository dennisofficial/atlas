import { describe, expect, test } from 'bun:test'

import { EClientRequest } from '@dltech/atlas-client/channel'
import { EPullRequestStateWire, type PrStateWire } from '@dltech/atlas-wire/web'

import { subscribePrStates, type PrStatesChannel } from '../pr-states-source'

const STATE: PrStateWire = {
  repo: 'github.com/o/r',
  number: 4,
  url: 'https://github.com/o/r/pull/4',
  branch: 'feat',
  state: EPullRequestStateWire.Open,
  checksRunning: 0,
  checksPassed: 2,
  checksFailed: 0,
  mergeable: true,
}

function fakeChannel(reply: unknown) {
  const listeners: Array<(states: readonly PrStateWire[]) => void> = []
  const requests: EClientRequest[] = []
  const channel: PrStatesChannel = {
    request: async ({ op }) => {
      requests.push(op)
      return reply
    },
    onPrStates: (listener) => {
      listeners.push(listener)
      return () => listeners.splice(listeners.indexOf(listener), 1)
    },
  }
  const push = (states: readonly PrStateWire[]) => {
    for (const listener of [...listeners]) listener(states)
  }
  return { channel, requests, push, listenerCount: () => listeners.length }
}

describe('subscribePrStates', () => {
  test('asks for the current states and delivers the reply', async () => {
    const fake = fakeChannel({ states: [STATE] })
    const seen: Array<readonly PrStateWire[]> = []
    subscribePrStates({ channel: fake.channel, onStates: (states) => seen.push(states) })
    await Bun.sleep(0)
    expect(fake.requests).toEqual([EClientRequest.ListPrStates])
    expect(seen).toEqual([[STATE]])
  })

  test('delivers pushed pr-states frames', async () => {
    const fake = fakeChannel(null)
    const seen: Array<readonly PrStateWire[]> = []
    const stop = subscribePrStates({
      channel: fake.channel,
      onStates: (states) => seen.push(states),
    })
    fake.push([STATE])
    stop()
    fake.push([])
    await Bun.sleep(0)
    expect(seen).toEqual([[STATE]])
    expect(fake.listenerCount()).toBe(0)
  })

  test('ignores a reply that is not a pr-states payload', async () => {
    const fake = fakeChannel({ nope: true })
    const seen: Array<readonly PrStateWire[]> = []
    subscribePrStates({ channel: fake.channel, onStates: (states) => seen.push(states) })
    await Bun.sleep(0)
    expect(seen).toEqual([])
  })
})
