import { describe, expect, it } from 'bun:test'

import { installOpenStreamCounter } from '../open-streams'

class FakeEventSource {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  readyState = FakeEventSource.OPEN

  constructor(readonly url: string | URL) {}

  close(): void {
    this.readyState = FakeEventSource.CLOSED
  }
}

const hostWithFake = () => ({ EventSource: FakeEventSource as unknown as typeof EventSource })

describe('installOpenStreamCounter', () => {
  it('counts event sources until they close', () => {
    const host = hostWithFake()
    const counter = installOpenStreamCounter(host)
    const first = new host.EventSource('/v1/trpc/a')
    new host.EventSource('/v1/trpc/b')
    expect(counter.count()).toBe(2)

    first.close()
    expect(counter.count()).toBe(1)
  })

  it('drops sources the browser closed on its own', () => {
    const host = hostWithFake()
    const counter = installOpenStreamCounter(host)
    const source = new host.EventSource('/v1/trpc/a') as unknown as FakeEventSource
    source.readyState = FakeEventSource.CLOSED
    expect(counter.count()).toBe(0)
  })

  it('reports zero without an EventSource', () => {
    expect(installOpenStreamCounter({}).count()).toBe(0)
  })
})
