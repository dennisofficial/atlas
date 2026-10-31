import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import { createDeltaChannel } from '@dltech/atlas-harness'

import { bindChildActivity } from '../serve-activity-binding'
import type { ActivityState } from '../serve-activity-reporter'
import { trpcOk, trpcUrl } from './trpc-fake'

const child = toThreadId('child-a')
const remote = { controlPlaneUrl: 'http://api', token: 't', clientVersion: '0', fetchFn: fetch }

describe('bindChildActivity adapter', () => {
  it('delegates the child subscription, injected reporter and detach', () => {
    const channel = createDeltaChannel()
    const states: ActivityState[] = []
    let subscribedTo: string | undefined
    const binding = bindChildActivity({
      threadId: child,
      remote,
      log: () => undefined,
      reporter: { report: (state) => states.push(state), whenIdle: async () => undefined },
      channel: {
        subscribe: (args) => {
          subscribedTo = args.threadId
          return channel.subscribe(args)
        },
      },
    })
    channel.publisherFor({ threadId: child }).turnWorking({ working: true })
    expect(subscribedTo).toBe('child-a')
    expect(states).toEqual([{ working: true, awaiting: null }])
    binding.detach()
    channel.publisherFor({ threadId: child }).turnWorking({ working: false })
    expect(states).toHaveLength(1)
  })

  it('constructs the child HTTP reporter and sends its threadId without a null outcome', async () => {
    const channel = createDeltaChannel()
    const sent = Promise.withResolvers<void>()
    const bodies: unknown[] = []
    const binding = bindChildActivity({
      threadId: child,
      channel,
      log: () => undefined,
      remote: {
        ...remote,
        fetchFn: (async (input: string | URL | Request, init?: RequestInit) => {
          expect(String(input)).toBe(
            trpcUrl({ controlPlaneUrl: 'http://api', procedure: 'sandboxSelf.activity' }),
          )
          bodies.push(JSON.parse(String(init?.body)))
          sent.resolve()
          return trpcOk(null)
        }) as typeof fetch,
      },
    })
    channel.publisherFor({ threadId: child }).turnWorking({ working: true })
    await sent.promise
    expect(bodies).toEqual([{ threadId: 'child-a', working: true, awaiting: null }])
    binding.detach()
  })
})
