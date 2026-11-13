import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { NAMING_WINDOW_MS } from '@dltech/atlas-control'
import { ESessionStatus } from '@dltech/atlas-core'
import {
  EStreamErrorCode,
  EStreamSubscribeKind,
  parseServerMessage,
  STREAM_MAX_SESSION_SUBSCRIPTIONS,
  type SessionSummary,
} from '@dltech/atlas-protocol'

import type { SubscriptionSession } from '../subscription-port'
import { FollowRig, OWNER, SESSION } from './follow-rig'
import { until } from './test-client'

const AT = '2026-11-02T12:00:00.000Z'
const ARCHIVED = '2026-11-02T13:00:00.000Z'

const asMessage = (text: string): string => JSON.stringify({ text })

describe('sessions subscription', () => {
  let rig: FollowRig
  let session: SubscriptionSession

  const listen = async (args: { id?: string; projectId?: string } = {}): Promise<void> => {
    await session.handle({
      type: 'subscribe',
      id: args.id ?? 'list',
      kind: EStreamSubscribeKind.Sessions,
      ...(args.projectId === undefined ? {} : { projectId: args.projectId }),
    })
  }

  const onlyRow = (): SessionSummary => {
    const [row] = rig.frames('snapshot')[0]?.rows ?? []
    if (row === undefined) throw new Error('no snapshot row')
    return row
  }

  beforeEach(async () => {
    rig = new FollowRig()
    await rig.seed({ events: 0 })
    session = rig.open()
  })

  afterEach(() => {
    rig.dispose()
  })

  it('snapshots only the owner sessions', async () => {
    await rig.seed({ events: 0, sessionId: 'other', userId: 'user-b' })
    await listen()
    expect(rig.frames('snapshot')).toHaveLength(1)
    expect(rig.frames('snapshot')[0]?.rows.map((row) => row.sessionId)).toEqual([SESSION])
    expect(onlyRow()).toEqual({
      sessionId: SESSION,
      projectId: 'project-1',
      title: null,
      naming: false,
      nested: true,
      mainThreadId: 'thread-1',
      createdAt: AT,
      updatedAt: AT,
      archivedAt: null,
      spawnedBy: null,
      routineId: null,
      model: null,
      status: { state: ESessionStatus.Preparing },
      primaryBranch: null,
      pullRequest: null,
    })
  })

  it('sends a version 1 connection rows without the view fields', async () => {
    const legacy = rig.open(OWNER, 1)
    await legacy.handle({ type: 'subscribe', id: 'old', kind: EStreamSubscribeKind.Sessions })
    await rig.settled()
    expect(onlyRow()).toEqual({
      sessionId: SESSION,
      projectId: 'project-1',
      title: null,
      naming: false,
      nested: true,
      mainThreadId: 'thread-1',
      createdAt: AT,
      updatedAt: AT,
      archivedAt: null,
    })
    await rig.plane.setSessionArchived({ sessionId: SESSION, archivedAt: AT })
    await rig.settled()
    const upserts = rig.frames('upsert')
    expect(upserts.length).toBeGreaterThan(0)
    for (const upsert of upserts) {
      expect(parseServerMessage(JSON.parse(JSON.stringify(upsert))).ok).toBe(true)
      expect(Object.keys(upsert.row)).not.toContain('status')
    }
  })

  it('filters the snapshot and later upserts by project', async () => {
    await rig.plane.createSession({
      sessionId: 'p2',
      userId: OWNER,
      projectId: 'project-2',
      mainThreadId: 'p2-thread',
    })
    await listen({ projectId: 'project-2' })
    expect(rig.frames('snapshot')[0]?.rows.map((row) => row.sessionId)).toEqual(['p2'])
    await rig.plane.titleUntitledSession({ sessionId: SESSION, title: 'Other Project' })
    await rig.settled()
    expect(rig.frames('upsert')).toEqual([])
    await rig.plane.titleUntitledSession({ sessionId: 'p2', title: 'Right Project' })
    await until(() => rig.frames('upsert').length === 1, 'upsert')
    expect(rig.frames('upsert')[0]?.row.sessionId).toBe('p2')
  })

  it('pushes one upsert with the new title when a session is titled', async () => {
    await listen()
    await rig.plane.post({ sessionId: SESSION, kind: 'message', payload: asMessage('fix build') })
    await until(() => rig.frames('upsert').length === 1, 'naming upsert')
    expect(rig.frames('upsert')[0]?.row).toMatchObject({ title: null, naming: true })
    await rig.plane.titleUntitledSession({ sessionId: SESSION, title: 'Build Fix' })
    await until(() => rig.frames('upsert').length === 2, 'title upsert')
    expect(rig.frames('upsert')[1]).toMatchObject({
      id: 'list',
      row: { sessionId: SESSION, title: 'Build Fix', naming: false },
    })
  })

  it('pushes an upsert carrying archivedAt on archive', async () => {
    await listen()
    await rig.plane.setSessionArchived({ sessionId: SESSION, archivedAt: ARCHIVED })
    await until(() => rig.frames('upsert').length === 1, 'archive upsert')
    expect(rig.frames('upsert')[0]?.row.archivedAt).toBe(ARCHIVED)
    expect(rig.frames('remove')).toEqual([])
  })

  it('sends nothing when a change leaves the row identical', async () => {
    await listen()
    await rig.plane.post({ sessionId: SESSION, kind: 'message', payload: asMessage('first') })
    await until(() => rig.frames('upsert').length === 1, 'first upsert')
    const reads = rig.digestReads
    await rig.plane.post({ sessionId: SESSION, kind: 'message', payload: asMessage('second') })
    await until(() => rig.digestReads > reads, 'recompute')
    await rig.settled()
    expect(rig.frames('upsert')).toHaveLength(1)
  })

  it('ignores another user session without reading digests', async () => {
    await listen()
    const reads = rig.digestReads
    await rig.seed({ events: 0, sessionId: 'other', userId: 'user-b' })
    await rig.plane.titleUntitledSession({ sessionId: 'other', title: 'Theirs' })
    await rig.settled()
    expect(rig.digestReads).toBe(reads)
    expect(rig.frames('upsert')).toEqual([])
  })

  it('reads nothing when no sessions subscription exists', async () => {
    await rig.plane.titleUntitledSession({ sessionId: SESSION, title: 'Quiet' })
    await rig.settled()
    expect(rig.digestReads).toBe(0)
  })

  it('upserts a session created for the user', async () => {
    await listen()
    await rig.seed({ events: 0, sessionId: 'fresh' })
    await until(() => rig.frames('upsert').length === 1, 'creation upsert')
    expect(rig.frames('upsert')[0]?.row.sessionId).toBe('fresh')
  })

  it('sends a fresh snapshot to every sessions subscription on gap', async () => {
    await listen({ id: 'a' })
    await listen({ id: 'b' })
    rig.emitGap()
    await until(() => rig.frames('snapshot').length === 4, 'gap snapshots')
    expect(
      rig
        .frames('snapshot')
        .map((frame) => frame.id)
        .sort(),
    ).toEqual(['a', 'a', 'b', 'b'])
  })

  it('resends a snapshot on resnap', async () => {
    await listen()
    await session.handle({ type: 'resnap', id: 'list' })
    expect(rig.frames('snapshot')).toHaveLength(2)
  })

  it('flips naming to the fallback title when the window passes without a title', async () => {
    await listen()
    await rig.plane.post({ sessionId: SESSION, kind: 'message', payload: asMessage('fix build') })
    await until(() => rig.frames('upsert').length === 1, 'naming upsert')
    expect(rig.timers.pendingCount()).toBe(1)
    rig.timers.advance(Date.parse(AT) + NAMING_WINDOW_MS)
    await until(() => rig.frames('upsert').length === 2, 'deadline upsert')
    expect(rig.frames('upsert')[1]?.row).toMatchObject({ title: 'fix build', naming: false })
    expect(rig.timers.pendingCount()).toBe(0)
  })

  it('stops upserts and clears the naming timer on unsubscribe', async () => {
    await listen()
    await rig.plane.post({ sessionId: SESSION, kind: 'message', payload: asMessage('fix build') })
    await until(() => rig.frames('upsert').length === 1, 'naming upsert')
    await session.handle({ type: 'unsubscribe', id: 'list' })
    expect(rig.timers.pendingCount()).toBe(0)
    await rig.plane.titleUntitledSession({ sessionId: SESSION, title: 'Late' })
    await rig.settled()
    expect(rig.frames('upsert')).toHaveLength(1)
  })

  it('stops everything when the connection closes', async () => {
    await listen()
    await rig.plane.post({ sessionId: SESSION, kind: 'message', payload: asMessage('fix build') })
    await until(() => rig.frames('upsert').length === 1, 'naming upsert')
    session.close()
    expect(rig.timers.pendingCount()).toBe(0)
    await rig.plane.titleUntitledSession({ sessionId: SESSION, title: 'Late' })
    await rig.settled()
    expect(rig.frames('upsert')).toHaveLength(1)
  })

  it('answers internal and stops when the snapshot read fails', async () => {
    rig.digestFailure = new Error('db down')
    await listen()
    expect(rig.sent).toEqual([{ type: 'error', id: 'list', code: EStreamErrorCode.Internal }])
    rig.digestFailure = undefined
    await rig.plane.titleUntitledSession({ sessionId: SESSION, title: 'After' })
    await rig.settled()
    expect(rig.frames('upsert')).toEqual([])
  })

  it('answers internal and stops when a recompute fails', async () => {
    await listen()
    rig.digestFailure = new Error('db down')
    await rig.plane.titleUntitledSession({ sessionId: SESSION, title: 'Boom' })
    await until(() => rig.frames('error').length === 1, 'error frame')
    expect(rig.frames('error')[0]).toEqual({
      type: 'error',
      id: 'list',
      code: EStreamErrorCode.Internal,
    })
  })

  it('answers bad-frame to a duplicate id and counts toward the subscription limit', async () => {
    await listen()
    await listen()
    expect(rig.frames('error')).toEqual([
      { type: 'error', id: 'list', code: EStreamErrorCode.BadFrame },
    ])
    for (let n = 1; n < STREAM_MAX_SESSION_SUBSCRIPTIONS; n += 1) {
      await listen({ id: `list-${n}` })
      if (n % 10 === 9) rig.timers.advance(1_000)
    }
    await listen({ id: 'over' })
    expect(rig.frames('error').at(-1)).toEqual({
      type: 'error',
      id: 'over',
      code: EStreamErrorCode.ForbiddenLimit,
    })
  })
})
