import { describe, expect, it } from 'bun:test'

import { EThreadLiveFrame, threadLiveFrameSchema, threadLiveOutputSchema } from '../index'

const thread = {
  id: 'thr_1',
  head: 3,
  createdAt: '2026-10-31T00:00:00.000Z',
  updatedAt: '2026-10-31T00:00:00.000Z',
  workspace: null,
  repo: null,
}

const row = {
  sessionId: 'ses_1',
  projectId: null,
  managedBySessionId: null,
  sortAt: '2026-10-31T00:00:00.000Z',
  rev: 2,
  thread,
}

const project = {
  id: 'prj_1',
  name: 'atlas',
  repo: 'dennisofficial/atlas',
  baseBranch: null,
  additionalRepos: [],
  description: '',
  createdAt: '2026-10-31T00:00:00.000Z',
  updatedAt: '2026-10-31T00:00:00.000Z',
}

describe('the live thread list wire', () => {
  it('parses each frame kind', () => {
    const frames = [
      { type: EThreadLiveFrame.Snapshot, rows: [row], projects: [project] },
      { type: EThreadLiveFrame.Upsert, row },
      { type: EThreadLiveFrame.Remove, sessionId: 'ses_1', threadId: 'thr_1', rev: 3 },
      { type: EThreadLiveFrame.ProjectUpsert, project },
      { type: EThreadLiveFrame.ProjectRemove, projectId: 'prj_1' },
      { type: EThreadLiveFrame.Resync, reason: 'subscriber reconnected' },
      { type: EThreadLiveFrame.Heartbeat },
    ]
    for (const frame of frames) expect(threadLiveFrameSchema.safeParse(frame).success).toBe(true)
  })

  it('rejects a row without a rev, a negative rev and an unknown kind', () => {
    const { rev: _rev, ...revless } = row
    expect(threadLiveFrameSchema.safeParse({ type: 'upsert', row: revless }).success).toBe(false)
    expect(
      threadLiveFrameSchema.safeParse({ type: 'upsert', row: { ...row, rev: -1 } }).success,
    ).toBe(false)
    expect(threadLiveFrameSchema.safeParse({ type: 'changed', threadId: 'thr_1' }).success).toBe(
      false,
    )
  })

  it('requires a reason on resync', () => {
    expect(threadLiveFrameSchema.safeParse({ type: 'resync' }).success).toBe(false)
  })

  it('accepts an async iterable as the output and nothing else', async () => {
    async function* frames() {
      yield { type: EThreadLiveFrame.Heartbeat }
    }
    expect(threadLiveOutputSchema.safeParse(frames()).success).toBe(true)
    expect(threadLiveOutputSchema.safeParse([]).success).toBe(false)
  })
})
