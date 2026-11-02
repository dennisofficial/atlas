import { describe, expect, it } from 'bun:test'

import { applyArchiveOverrides, settleArchiveOverrides } from '../archive-overrides'
import { agoIso, projectOf, sessionOf, threadOf } from './fixtures'

const entries = [
  {
    project: projectOf('p1'),
    sessions: [
      sessionOf(threadOf({ id: 'a' })),
      sessionOf(threadOf({ id: 'b', archivedAt: agoIso(2) })),
      sessionOf(threadOf({ id: 'c', archivedAt: null })),
    ],
  },
]

describe('applyArchiveOverrides', () => {
  it('returns the entries unchanged when there are no overrides', () => {
    expect(applyArchiveOverrides({ entries, overrides: new Map() })).toEqual(entries)
  })

  it('stamps an archived override and clears an unarchive override', () => {
    const stamp = agoIso(0)
    const result = applyArchiveOverrides({
      entries,
      overrides: new Map([
        ['a', stamp],
        ['b', null],
      ]),
    })
    const sessions = result[0]?.sessions ?? []
    expect(sessions.map((session) => session.mainThread.archivedAt)).toEqual([stamp, null, null])
  })

  it('does not mutate the source entries', () => {
    applyArchiveOverrides({ entries, overrides: new Map([['a', agoIso(0)]]) })
    expect(entries[0]?.sessions[0]?.mainThread.archivedAt).toBeUndefined()
  })

  it('stamps an override on a nested teammate and its children', () => {
    const stamp = agoIso(0)
    const nested = [
      {
        project: projectOf('p1'),
        sessions: [
          sessionOf(threadOf({ id: 'lead' }), [
            sessionOf(threadOf({ id: 'mate' }), [sessionOf(threadOf({ id: 'leaf' }))]),
          ]),
        ],
      },
    ]
    const result = applyArchiveOverrides({
      entries: nested,
      overrides: new Map([
        ['mate', stamp],
        ['leaf', stamp],
      ]),
    })
    const mate = result[0]?.sessions[0]?.teammates[0]
    expect(mate?.mainThread.archivedAt).toBe(stamp)
    expect(mate?.teammates[0]?.mainThread.archivedAt).toBe(stamp)
    expect(result[0]?.sessions[0]?.mainThread.archivedAt).toBeUndefined()
    expect(nested[0]?.sessions[0]?.teammates[0]?.mainThread.archivedAt).toBeUndefined()
  })
})

describe('settleArchiveOverrides', () => {
  it('drops an override once the server agrees on archived-ness', () => {
    const overrides = new Map<string, string | null>([
      ['a', agoIso(0)],
      ['b', null],
    ])
    const settled = settleArchiveOverrides({ entries, overrides })
    expect([...settled.keys()]).toEqual(['a', 'b'])
    const synced = settleArchiveOverrides({
      entries: [
        {
          project: projectOf('p1'),
          sessions: [
            sessionOf(threadOf({ id: 'a', archivedAt: agoIso(0) })),
            sessionOf(threadOf({ id: 'b' })),
          ],
        },
      ],
      overrides,
    })
    expect(synced.size).toBe(0)
  })

  it('treats null and undefined archivedAt as the same unarchived state', () => {
    const settled = settleArchiveOverrides({
      entries,
      overrides: new Map([
        ['a', null],
        ['c', null],
      ]),
    })
    expect(settled.size).toBe(0)
  })

  it('keeps overrides for threads the server data does not contain', () => {
    const overrides = new Map<string, string | null>([['gone', agoIso(0)]])
    expect(settleArchiveOverrides({ entries, overrides })).toBe(overrides)
  })

  it('settles an override once the server agrees on a nested teammate', () => {
    const overrides = new Map<string, string | null>([['mate', agoIso(0)]])
    const nested = [
      {
        project: projectOf('p1'),
        sessions: [sessionOf(threadOf({ id: 'lead' }), [sessionOf(threadOf({ id: 'mate' }))])],
      },
    ]
    expect(settleArchiveOverrides({ entries: nested, overrides }).size).toBe(1)
    const synced = [
      {
        project: projectOf('p1'),
        sessions: [
          sessionOf(threadOf({ id: 'lead' }), [
            sessionOf(threadOf({ id: 'mate', archivedAt: agoIso(0) })),
          ]),
        ],
      },
    ]
    expect(settleArchiveOverrides({ entries: synced, overrides }).size).toBe(0)
  })
})
