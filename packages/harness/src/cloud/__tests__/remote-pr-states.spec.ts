import { describe, expect, it } from 'bun:test'

import { EPullRequestStateWire, type PrStateWire } from '@dltech/atlas-wire'

import { EClientRequest } from '../channel-wire'
import { RemoteRequestFailed, RemoteRequestLost } from '../remote-channel-upstream'
import { createRemotePrStateReader, EMPTY_PR_STATES } from '../remote-pr-states'

const prState: PrStateWire = {
  repo: 'dennisofficial/atlas',
  number: 1042,
  url: 'https://github.com/dennisofficial/atlas/pull/1042',
  branch: 'dennis/pr-states',
  state: EPullRequestStateWire.Open,
  checksRunning: 0,
  checksPassed: 0,
  checksFailed: 0,
  mergeable: null,
}

const channel = (overrides?: {
  request?: (op: EClientRequest) => Promise<unknown>
  onPrStates?: (listener: (states: readonly PrStateWire[]) => void) => () => void
}) => {
  const pushListeners = new Set<(states: readonly PrStateWire[]) => void>()
  return {
    request: async ({ op }: { op: EClientRequest; params: unknown }): Promise<unknown> =>
      overrides?.request !== undefined ? await overrides.request(op) : { states: [] },
    onPrStates: overrides?.onPrStates ?? ((listener) => {
      pushListeners.add(listener)
      return () => pushListeners.delete(listener)
    }),
    onReload: () => () => undefined,
    onReady: () => () => undefined,
    push(states: readonly PrStateWire[]): void {
      for (const listener of [...pushListeners]) listener(states)
    },
  }
}

describe('a refused list-pr-states read', () => {
  it('falls back to the held set instead of throwing', async () => {
    const reader = createRemotePrStateReader({
      channel: channel({
        request: () =>
          Promise.reject(new RemoteRequestFailed({ op: EClientRequest.ListPrStates, data: {} })),
      }),
    })

    expect(await reader.states()).toBe(EMPTY_PR_STATES)
  })
})

describe('a list-pr-states read lost to a socket drop', () => {
  it('falls back to the held set instead of rejecting', async () => {
    const reader = createRemotePrStateReader({
      channel: channel({
        request: () =>
          Promise.reject(
            new RemoteRequestLost({ op: EClientRequest.ListPrStates, reason: 'the session socket closed' }),
          ),
      }),
    })

    expect(await reader.states()).toBe(EMPTY_PR_STATES)
  })

  it('keeps the last pushed set as the fallback', async () => {
    const fake = channel({
      request: () =>
        Promise.reject(
          new RemoteRequestLost({ op: EClientRequest.ListPrStates, reason: 'the session socket closed' }),
        ),
    })
    const reader = createRemotePrStateReader({ channel: fake })

    const off = reader.onChange(() => undefined)
    fake.push([prState])

    expect(await reader.states()).toEqual([prState])
    off()
  })

  it('heals on the next answer once the channel is back', async () => {
    let answer: Promise<unknown> = Promise.reject(
      new RemoteRequestLost({ op: EClientRequest.ListPrStates, reason: 'the session socket closed' }),
    )
    const reader = createRemotePrStateReader({
      channel: channel({ request: () => answer }),
    })

    expect(await reader.states()).toBe(EMPTY_PR_STATES)

    answer = Promise.resolve({ states: [prState] })
    expect(await reader.states()).toEqual([prState])
    expect(reader.current()).toEqual([prState])
  })
})

describe('a live list-pr-states read', () => {
  it('still rejects an unexpected failure', async () => {
    const reader = createRemotePrStateReader({
      channel: channel({ request: () => Promise.reject(new Error('boom')) }),
    })

    await expect(reader.states()).rejects.toThrow('boom')
  })

  it('updates the held set from a push and notifies listeners', async () => {
    const fake = channel()
    const reader = createRemotePrStateReader({ channel: fake })

    let poked = 0
    const off = reader.onChange(() => {
      poked += 1
    })
    fake.push([prState])

    expect(reader.current()).toEqual([prState])
    expect(poked).toBe(1)
    off()
  })
})
