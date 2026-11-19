import { describe, expect, it } from 'bun:test'
import type { Db } from '@dltech/atlas-db'

import { agent37InstanceIdsOf } from '../agent37-instance-store'

type Row = {
  id: string
  podSessionId: string | null
  sandboxInstanceId: string | null
}

const fakeDb = (rows: Row[]): Db => {
  const matching = (filter: { id?: string; podSessionId?: string }): Row | null => {
    const found = rows.find(
      (row) =>
        (filter.id === undefined || row.id === filter.id) &&
        (filter.podSessionId === undefined || row.podSessionId === filter.podSessionId),
    )
    return found ?? null
  }
  return {
    orm: {
      v2: {
        V2Session: {
          first: async (filter: { id?: string; podSessionId?: string }) => matching(filter),
          where: (filter: { id: string }) => ({
            updateAndCount: async (values: { sandboxInstanceId: string | null }) => {
              const row = matching(filter)
              if (row === null) return 0
              row.sandboxInstanceId = values.sandboxInstanceId
              return 1
            },
          }),
        },
      },
    },
  } as unknown as Db
}

describe('agent37 instance ids', () => {
  it('remembers the instance on a session whose podSessionId is not set yet', async () => {
    const row: Row = { id: 'session-1', podSessionId: null, sandboxInstanceId: null }
    const ids = agent37InstanceIdsOf(fakeDb([row]))

    await ids.remember({ podSessionId: 'session-1', instanceId: 'inst-1' })

    expect(row.sandboxInstanceId).toBe('inst-1')
    expect(await ids.find({ podSessionId: 'session-1' })).toBe('inst-1')
  })

  it('resolves through a podSessionId once the pod reported one', async () => {
    const row: Row = { id: 'session-1', podSessionId: 'pod-1', sandboxInstanceId: null }
    const ids = agent37InstanceIdsOf(fakeDb([row]))

    await ids.remember({ podSessionId: 'pod-1', instanceId: 'inst-1' })

    expect(await ids.find({ podSessionId: 'pod-1' })).toBe('inst-1')
    expect(await ids.find({ podSessionId: 'session-1' })).toBeNull()
  })

  it('reports nothing for an unknown session', async () => {
    const ids = agent37InstanceIdsOf(fakeDb([]))

    await ids.remember({ podSessionId: 'missing', instanceId: 'inst-1' })

    expect(await ids.find({ podSessionId: 'missing' })).toBeNull()
  })

  it('clears the instance a session remembered once it is deleted', async () => {
    const row: Row = { id: 'session-1', podSessionId: null, sandboxInstanceId: 'inst-1' }
    const ids = agent37InstanceIdsOf(fakeDb([row]))

    await ids.forget({ podSessionId: 'session-1' })

    expect(row.sandboxInstanceId).toBeNull()
    expect(await ids.find({ podSessionId: 'session-1' })).toBeNull()
  })
})
