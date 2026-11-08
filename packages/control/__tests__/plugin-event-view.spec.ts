import { beforeEach, describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { createV2EventSchema } from '@dltech/atlas-core'

import { InMemoryControlStore } from '../src/testing/memory'
import {
  appendBodies,
  makeHarness,
  said,
  seedGranted,
  SESSION,
  THREAD,
  type Harness,
} from '../src/testing/conformance/support'

declare module '@dltech/atlas-core' {
  interface PluginEventBodies {
    'probe-observed': { type: 'probe-observed'; label: string }
  }
}

const probeObservedSchema = z.object({
  type: z.literal('probe-observed'),
  label: z.string().min(1),
})

const composedHarness = (store: InMemoryControlStore): Harness =>
  makeHarness(store, createV2EventSchema({ pluginBodies: [probeObservedSchema] }))

describe('a plugin event through the session view', () => {
  let store: InMemoryControlStore

  beforeEach(() => {
    store = new InMemoryControlStore()
  })

  const lagTheView = async (): Promise<void> => {
    await store.transact((tx) =>
      tx.writeSessionView({
        sessionId: SESSION,
        threadId: THREAD,
        atSeq: 0,
        version: 0,
        state: 'x',
      }),
    )
  }

  it('is caught up when the plane composes the plugin schema', async () => {
    const composed = composedHarness(store)
    const epoch = await seedGranted(composed)
    await appendBodies({
      harness: composed,
      epoch,
      bodies: [said('a'), { type: 'probe-observed', label: 'x' }],
    })
    await lagTheView()

    const read = await composed.plane.readSessionView({ sessionId: SESSION, threadId: THREAD })
    expect(read.at).toBe(2)
  })

  it('fails the catch-up on a plane built with core alone', async () => {
    const composed = composedHarness(store)
    const epoch = await seedGranted(composed)
    await appendBodies({
      harness: composed,
      epoch,
      bodies: [said('a'), { type: 'probe-observed', label: 'x' }],
    })
    await lagTheView()

    const core = makeHarness(store)
    await expect(
      core.plane.readSessionView({ sessionId: SESSION, threadId: THREAD }),
    ).rejects.toThrow('stored event thread-1:2 is invalid')
  })
})
