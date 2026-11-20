import { beforeEach, describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { createV2EventSchema, type PluginViewFold } from '@dltech/atlas-core'

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
    'mcp-server-changed': {
      type: 'mcp-server-changed'
      row: { name: string; status: string; toolCount: number }
    }
  }
}

const mcpServerChangedSchema = z.object({
  type: z.literal('mcp-server-changed'),
  row: z.object({ name: z.string().min(1), status: z.string(), toolCount: z.number().int() }),
})

const changed = (name: string) =>
  ({
    type: 'mcp-server-changed',
    row: { name, status: 'failed', toolCount: 0 },
  }) as const

const failedRosterView: PluginViewFold<readonly string[]> = {
  name: 'roster',
  initial: [],
  fold: (state, event) =>
    event.type === 'mcp-server-changed' ? [...state, event.row.name] : state,
}

const composedHarness = (store: InMemoryControlStore): Harness =>
  makeHarness(store, createV2EventSchema({ pluginBodies: [mcpServerChangedSchema] }), {
    pluginViews: [failedRosterView as PluginViewFold],
  })

describe('the session busy read', () => {
  let store: InMemoryControlStore

  beforeEach(() => {
    store = new InMemoryControlStore()
  })

  const seed = async (): Promise<Harness> => {
    const composed = composedHarness(store)
    const epoch = await seedGranted(composed)
    await appendBodies({
      harness: composed,
      epoch,
      bodies: [said('a'), changed('storybook')],
    })
    return composed
  }

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

  it('answers from a current view on a plane that cannot decode the plugin event', async () => {
    const composed = await seed()
    const view = await composed.plane.readSessionView({ sessionId: SESSION, threadId: THREAD })
    const core = makeHarness(store)

    const busy = await core.plane.readSessionBusy({ sessionId: SESSION, threadId: THREAD })
    expect(busy.at).toBe(2)
    expect(busy.status.state).toBe(view.value.status.state)

    await expect(
      core.plane.readSessionView({ sessionId: SESSION, threadId: THREAD }),
    ).rejects.toThrow('stored event thread-1:2 is invalid')
  })

  it('still refuses to catch a view up over an event it cannot decode', async () => {
    await seed()
    await lagTheView()

    const core = makeHarness(store)
    await expect(
      core.plane.readSessionBusy({ sessionId: SESSION, threadId: THREAD }),
    ).rejects.toThrow('stored event thread-1:2 is invalid')
  })

  it('carries the plugin views the busy check counts shells and services from', async () => {
    const composed = await seed()
    await lagTheView()

    const busy = await composed.plane.readSessionBusy({ sessionId: SESSION, threadId: THREAD })
    expect(busy.at).toBe(2)
    expect(busy.pluginViews['roster']).toEqual(['storybook'])
  })
})
