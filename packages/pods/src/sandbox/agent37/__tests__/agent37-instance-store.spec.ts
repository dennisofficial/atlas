import { describe, expect, it } from 'bun:test'
import type { Db } from '@dltech/atlas-db'

import { agent37InstanceIdsOf } from '../agent37-instance-store'

type Row = {
  id: string
  podSessionId: string | null
  sandboxInstanceId: string | null
  sandboxStatus: string | null
  sandboxStatusAt: Date | null
}

type Predicate = (row: Row) => boolean

type Condition = Predicate | { kind: 'and' | 'or'; exprs: Condition[] }

const holds = (condition: Condition, row: Row): boolean => {
  if (typeof condition === 'function') return condition(row)
  const results = condition.exprs.map((expr) => holds(expr, row))
  return condition.kind === 'or' ? results.some(Boolean) : results.every(Boolean)
}

const columnOf = <T>(read: (row: Row) => T) => ({
  eq:
    (value: T): Predicate =>
    (row) =>
      read(row) === value,
  lt:
    (value: Date): Predicate =>
    (row) => {
      const actual = read(row)
      return actual instanceof Date && actual.getTime() < value.getTime()
    },
  isNull: (): Predicate => (row) => read(row) === null,
})

const columns = {
  id: columnOf((row) => row.id),
  podSessionId: columnOf((row) => row.podSessionId),
  sandboxStatusAt: columnOf((row) => row.sandboxStatusAt),
}

type Filter = { id?: string; podSessionId?: string } | ((session: typeof columns) => Condition)

const matcherOf = (filter: Filter): Predicate =>
  typeof filter === 'function'
    ? (row) => holds(filter(columns), row)
    : (row) =>
        (filter.id === undefined || row.id === filter.id) &&
        (filter.podSessionId === undefined || row.podSessionId === filter.podSessionId)

const fakeDb = (args: { rows: Row[]; beforeUpdate?: (rows: Row[]) => void }): Db => {
  const first = async (filter: { id?: string; podSessionId?: string }): Promise<Row | null> =>
    args.rows.find(matcherOf(filter)) ?? null
  return {
    orm: {
      public: {
        Session: {
          first,
          where: (filter: Filter) => ({
            updateAndCount: async (values: Partial<Row>) => {
              args.beforeUpdate?.(args.rows)
              const matched = args.rows.filter(matcherOf(filter)).slice(0, 1)
              for (const row of matched) Object.assign(row, values)
              return matched.length
            },
          }),
        },
      },
    },
  } as unknown as Db
}

const rowOf = (overrides: Partial<Row> = {}): Row => ({
  id: 'session-1',
  podSessionId: null,
  sandboxInstanceId: null,
  sandboxStatus: null,
  sandboxStatusAt: null,
  ...overrides,
})

describe('agent37 instance ids', () => {
  it('remembers the instance on a session whose podSessionId is not set yet', async () => {
    const row = rowOf()
    const ids = agent37InstanceIdsOf(fakeDb({ rows: [row] }))

    await ids.remember({ podSessionId: 'session-1', instanceId: 'inst-1' })

    expect(row.sandboxInstanceId).toBe('inst-1')
    expect(await ids.find({ podSessionId: 'session-1' })).toBe('inst-1')
  })

  it('resolves through a podSessionId once the pod reported one', async () => {
    const row = rowOf({ podSessionId: 'pod-1' })
    const ids = agent37InstanceIdsOf(fakeDb({ rows: [row] }))

    await ids.remember({ podSessionId: 'pod-1', instanceId: 'inst-1' })

    expect(await ids.find({ podSessionId: 'pod-1' })).toBe('inst-1')
    expect(await ids.find({ podSessionId: 'session-1' })).toBeNull()
  })

  it('reports nothing for an unknown session', async () => {
    const ids = agent37InstanceIdsOf(fakeDb({ rows: [] }))

    await ids.remember({ podSessionId: 'missing', instanceId: 'inst-1' })

    expect(await ids.find({ podSessionId: 'missing' })).toBeNull()
  })

  it('clears the instance a session remembered once it is deleted', async () => {
    const row = rowOf({ sandboxInstanceId: 'inst-1' })
    const ids = agent37InstanceIdsOf(fakeDb({ rows: [row] }))

    await ids.forget({ podSessionId: 'session-1' })

    expect(row.sandboxInstanceId).toBeNull()
    expect(await ids.find({ podSessionId: 'session-1' })).toBeNull()
  })
})

describe('agent37 seeded status', () => {
  it('stamps a row that has no status yet', async () => {
    const row = rowOf()
    const ids = agent37InstanceIdsOf(fakeDb({ rows: [row] }))

    await ids.seedStatus({
      podSessionId: 'session-1',
      status: 'running',
      at: '2026-11-21T10:00:00.000Z',
    })

    expect(row.sandboxStatus).toBe('running')
    expect(row.sandboxStatusAt).toEqual(new Date('2026-11-21T10:00:00.000Z'))
  })

  it('leaves a declaration newer than the seed alone', async () => {
    const row = rowOf({
      sandboxStatus: 'sleeping',
      sandboxStatusAt: new Date('2026-11-21T10:00:05.000Z'),
    })
    const ids = agent37InstanceIdsOf(fakeDb({ rows: [row] }))

    await ids.seedStatus({
      podSessionId: 'session-1',
      status: 'running',
      at: '2026-11-21T10:00:00.000Z',
    })

    expect(row.sandboxStatus).toBe('sleeping')
  })

  it('keeps a webhook that landed while the seed was reading the row', async () => {
    const row = rowOf({
      sandboxStatus: 'provisioning',
      sandboxStatusAt: new Date('2026-11-21T10:00:00.000Z'),
    })
    const ids = agent37InstanceIdsOf(
      fakeDb({
        rows: [row],
        beforeUpdate: () => {
          row.sandboxStatus = 'running'
          row.sandboxStatusAt = new Date('2026-11-21T10:00:01.000Z')
        },
      }),
    )

    await ids.seedStatus({
      podSessionId: 'session-1',
      status: 'provisioning',
      at: '2026-11-21T10:00:00.500Z',
    })

    expect(row.sandboxStatus).toBe('running')
    expect(row.sandboxStatusAt).toEqual(new Date('2026-11-21T10:00:01.000Z'))
  })
})
