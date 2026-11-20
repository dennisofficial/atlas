import { describe, expect, it } from 'bun:test'

import {
  byokPodIdsOf,
  planByokRetire,
  podIdOf,
  retirePatchOf,
  sessionsByUserOf,
  type ByokSessionRow,
  type PodSandboxRow,
} from './retire-byok-plan'

const session = (over: Partial<ByokSessionRow> = {}): ByokSessionRow => ({
  sessionId: 's-1',
  userId: 'user-1',
  podSessionId: null,
  archivedAt: null,
  ...over,
})

const sandbox = (over: Partial<PodSandboxRow> = {}): PodSandboxRow => ({
  name: 'atlas-pod-s-1',
  podSessionId: 's-1',
  running: false,
  ...over,
})

describe('podIdOf', () => {
  it('retires the pod a sub-agent session shares with its spawner', () => {
    expect(podIdOf(session({ sessionId: 'child', podSessionId: 'parent' }))).toBe('parent')
  })

  it('retires the session own pod when nothing shares it', () => {
    expect(podIdOf(session({ sessionId: 'solo' }))).toBe('solo')
  })
})

describe('byokPodIdsOf', () => {
  it('collects every pod these sessions run on', () => {
    expect(
      [
        ...byokPodIdsOf([
          session({ sessionId: 'a' }),
          session({ sessionId: 'child', podSessionId: 'a' }),
          session({ sessionId: 'b' }),
        ]),
      ].sort(),
    ).toEqual(['a', 'b'])
  })
})

describe('sessionsByUserOf', () => {
  it('groups the rows by the owner whose vercel credential owns their pods', () => {
    const grouped = sessionsByUserOf([
      session({ sessionId: 'a' }),
      session({ sessionId: 'b', userId: 'user-2' }),
    ])
    expect([...grouped.keys()]).toEqual(['user-1', 'user-2'])
    expect(grouped.get('user-2')?.map((row) => row.sessionId)).toEqual(['b'])
  })
})

describe('planByokRetire', () => {
  const pods = new Set(['s-1'])

  it('stops a running byok pod before removing it', () => {
    const plan = planByokRetire({ sandboxes: [sandbox({ running: true })], pods })
    expect(plan.stop.map((row) => row.name)).toEqual(['atlas-pod-s-1'])
    expect(plan.remove.map((row) => row.name)).toEqual(['atlas-pod-s-1'])
    expect(plan.keep).toEqual([])
  })

  it('removes a stopped byok pod without stopping it again', () => {
    const plan = planByokRetire({ sandboxes: [sandbox()], pods })
    expect(plan.stop).toEqual([])
    expect(plan.remove.map((row) => row.name)).toEqual(['atlas-pod-s-1'])
  })

  it('keeps a pod no byok session runs on', () => {
    const plan = planByokRetire({
      sandboxes: [sandbox({ name: 'atlas-pod-s-9', podSessionId: 's-9', running: true })],
      pods,
    })
    expect(plan.stop).toEqual([])
    expect(plan.remove).toEqual([])
    expect(plan.keep.map((row) => row.name)).toEqual(['atlas-pod-s-9'])
  })

  it('keeps every sandbox that is not a v2 pod', () => {
    const plan = planByokRetire({
      sandboxes: [sandbox({ name: 'v1-whatever', podSessionId: null, running: true })],
      pods,
    })
    expect(plan.stop).toEqual([])
    expect(plan.remove).toEqual([])
    expect(plan.keep.map((row) => row.name)).toEqual(['v1-whatever'])
  })
})

describe('retirePatchOf', () => {
  const now = new Date('2026-11-20T10:00:00.000Z')

  it('archives an unarchived session and marks it deleted', () => {
    expect(retirePatchOf({ session: session(), now })).toEqual({ archivedAt: now, deletedAt: now })
  })

  it('keeps the archive date a session already carries', () => {
    const archivedAt = new Date('2026-10-01T00:00:00.000Z')
    expect(retirePatchOf({ session: session({ archivedAt }), now })).toEqual({
      archivedAt,
      deletedAt: now,
    })
  })
})
