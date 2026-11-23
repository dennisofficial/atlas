import { describe, expect, it } from 'bun:test'

import type { SessionCommandInput, SessionCommandOutput } from '@dltech/atlas-protocol'

import { requestResume, resumePendingOf } from '../session-commands'

const recordingApi = (calls: SessionCommandInput[]) => ({
  command: (input: SessionCommandInput): Promise<SessionCommandOutput> => {
    calls.push(input)
    return Promise.resolve({ inboxId: 4 })
  },
})

describe('requestResume', () => {
  it('posts the resume command for the session with no arguments', async () => {
    const calls: SessionCommandInput[] = []

    await requestResume({ api: recordingApi(calls), sessionId: 's1' })

    expect(calls).toEqual([{ sessionId: 's1', name: 'resume', args: {} }])
  })

  it('names the sub-agent when it resumes a child', async () => {
    const calls: SessionCommandInput[] = []

    await requestResume({ api: recordingApi(calls), sessionId: 's1', agentId: 'agent-7' })

    expect(calls).toEqual([{ sessionId: 's1', name: 'resume', args: { agentId: 'agent-7' } }])
  })
})

describe('resumePendingOf', () => {
  it('is pending while a resume entry is queued', () => {
    expect(
      resumePendingOf([
        {
          inboxId: 1,
          name: 'resume',
          postedAt: '2026-11-23T10:00:00.000Z',
          state: 'queued',
        },
      ]),
    ).toBe(true)
  })

  it('is idle without a resume entry', () => {
    expect(resumePendingOf(undefined)).toBe(false)
    expect(resumePendingOf([])).toBe(false)
  })
})
