import { beforeEach, describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { createV2EventSchema, type V2Event } from '@dltech/atlas-core'

import type { AppendHook } from '../src/append-hooks'
import { InMemoryControlStore } from '../src/testing/memory'
import {
  appendBodies,
  makeHarness,
  said,
  seedGranted,
  SESSION,
  THREAD,
} from '../src/testing/conformance/support'

declare module '@dltech/atlas-core' {
  interface PluginEventBodies {
    'probe-observed': { type: 'probe-observed'; label: string }
  }
}

const schema = createV2EventSchema({
  pluginBodies: [z.object({ type: z.literal('probe-observed'), label: z.string().min(1) })],
})

type Seen = { sessionId: string; type: string; headSeqInTx: number }

const hookOf = (args: { seen: Seen[]; fail?: boolean }): AppendHook => ({
  name: 'probe',
  appliesTo: (event: V2Event) => event.type === 'probe-observed',
  handle: async ({ tx, sessionId, event }) => {
    const thread = await tx.readThread(event.threadId)
    args.seen.push({ sessionId, type: event.type, headSeqInTx: thread?.headSeq ?? -1 })
    if (args.fail) throw new Error('hook failed')
  },
})

describe('append hooks', () => {
  let store: InMemoryControlStore
  const seen: Seen[] = []

  beforeEach(() => {
    store = new InMemoryControlStore()
    seen.length = 0
  })

  it('runs for an applicable event inside the append transaction with the session', async () => {
    const harness = makeHarness(store, schema, { appendHooks: [hookOf({ seen })] })
    const epoch = await seedGranted(harness)
    await appendBodies({
      harness,
      epoch,
      bodies: [said('a'), { type: 'probe-observed', label: 'x' }],
    })
    expect(seen).toEqual([{ sessionId: SESSION, type: 'probe-observed', headSeqInTx: 0 }])
  })

  it('skips events no hook applies to', async () => {
    const harness = makeHarness(store, schema, { appendHooks: [hookOf({ seen })] })
    const epoch = await seedGranted(harness)
    await appendBodies({ harness, epoch, bodies: [said('a')] })
    expect(seen).toEqual([])
  })

  it('rolls the whole append back when a hook throws', async () => {
    const harness = makeHarness(store, schema, { appendHooks: [hookOf({ seen, fail: true })] })
    const epoch = await seedGranted(harness)
    await expect(
      appendBodies({ harness, epoch, bodies: [said('a'), { type: 'probe-observed', label: 'x' }] }),
    ).rejects.toThrow('hook failed')
    expect((await harness.plane.head({ threadId: THREAD })).seq).toBe(0)
  })

  it('changes nothing on a plane with no hooks', async () => {
    const harness = makeHarness(store, schema)
    const epoch = await seedGranted(harness)
    await appendBodies({ harness, epoch, bodies: [{ type: 'probe-observed', label: 'x' }] })
    expect((await harness.plane.head({ threadId: THREAD })).seq).toBe(1)
  })
})
