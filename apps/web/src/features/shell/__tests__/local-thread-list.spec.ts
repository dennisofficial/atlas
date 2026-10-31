import { describe, expect, it } from 'bun:test'

import { localSessionOf, localThreadOf, withLocalThreads } from '@/features/desktop/local-thread'

import { isUnread, threadStatusOf, EThreadStatus } from '../thread-status'
import { projectOf, sessionOf, threadOf } from './fixtures'

const summary = () => ({
  threadId: 'local-1',
  projectId: 'p1',
  title: 'Stored title',
  head: 29,
  readSeq: 5,
  model: 'provider/model',
  effort: 'high',
  createdAt: '2026-10-24T10:00:00.000Z',
  updatedAt: '2026-10-30T12:00:00.000Z',
  status: {
    working: false,
    awaiting: null,
    lastOutcome: null,
    podState: 'parked' as const,
    lastAssistantSeq: 17,
    readSeq: 5,
  },
})

describe('local thread list projection', () => {
  it('uses the durable summary for head, title, dates, model and status', () => {
    const stored = summary()
    expect(localThreadOf(stored)).toEqual({
      id: 'local-1',
      head: 29,
      title: 'Stored title',
      createdAt: '2026-10-24T10:00:00.000Z',
      updatedAt: '2026-10-30T12:00:00.000Z',
      model: { ref: 'provider/model', effort: 'high' },
      projectId: 'p1',
      runner: 'local',
      workspace: null,
      repo: null,
      status: stored.status,
    })
    expect(localSessionOf(stored)).toMatchObject({
      id: 'local_local-1',
      mainThread: { id: 'local-1', head: 29 },
      teammates: [],
    })
  })

  it('shows assistant-only unread output and clears it using the next host read cursor', () => {
    const stored = summary()
    expect(isUnread({ thread: localThreadOf(stored), active: false })).toBe(true)
    const read = { ...stored, readSeq: 29, status: { ...stored.status, readSeq: 29 } }
    expect(isUnread({ thread: localThreadOf(read), active: false })).toBe(false)
    const userOnly = { ...stored, status: { ...stored.status, lastAssistantSeq: 0 } }
    expect(isUnread({ thread: localThreadOf(userOnly), active: false })).toBe(false)
    expect(threadStatusOf(localThreadOf(stored))).toBe(EThreadStatus.Idle)
    const working = { ...stored, status: { ...stored.status, working: true } }
    expect(threadStatusOf(localThreadOf(working))).toBe(EThreadStatus.Running)
    expect(isUnread({ thread: localThreadOf(working), active: false })).toBe(false)
  })

  it('creates the existing No project group when no Cloud projects were returned', () => {
    const merged = withLocalThreads({ entries: [], threads: [summary()] })
    expect(merged).toMatchObject([
      { project: null, sessions: [{ mainThread: { id: 'local-1', projectId: 'p1' } }] },
    ])
  })

  it('keeps projectless and unmatched roots in No project and removes mirrored duplicates', () => {
    const stored = summary()
    const cloud = threadOf({ id: 'local-1', title: 'Stale cloud title' })
    const merged = withLocalThreads({
      entries: [
        {
          project: projectOf('p1'),
          sessions: [sessionOf(cloud), sessionOf(threadOf({ id: 'cloud-only' }))],
        },
        { project: null, sessions: [] },
      ],
      threads: [
        stored,
        { ...stored, threadId: 'unmatched', projectId: 'gone' },
        { ...stored, threadId: 'projectless', projectId: null },
        stored,
      ],
    })
    expect(
      merged.map((entry) => ({
        project: entry.project?.id ?? null,
        threads: entry.sessions.map((session) => session.mainThread.id),
      })),
    ).toEqual([
      { project: 'p1', threads: ['cloud-only', 'local-1'] },
      { project: null, threads: ['unmatched', 'projectless'] },
    ])
    expect(merged[0]?.sessions[1]?.mainThread.title).toBe('Stored title')
  })
})
