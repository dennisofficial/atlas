import { describe, expect, it } from 'bun:test'

import type { StreamSessionRow } from '@dltech/atlas-protocol'

import { EWorkKind } from '../../../sessions/session-groups'
import { sessionHeaderOf, UNTITLED } from '../session-header'

const summaryOf = (fields: Partial<StreamSessionRow>): StreamSessionRow => ({
  sessionId: 'ses_1',
  projectId: null,
  title: 'Fix the flaky spec',
  naming: false,
  mainThreadId: 'thr_1',
  createdAt: '2026-11-23T10:00:00.000Z',
  updatedAt: '2026-11-23T10:00:00.000Z',
  archivedAt: null,
  model: { ref: 'anthropic/claude-opus', effort: 'high', fast: false },
  ...fields,
})

const headerOf = (args: { summary?: StreamSessionRow; fallbackTitle?: string }) =>
  sessionHeaderOf({ summary: args.summary, fallbackTitle: args.fallbackTitle })

describe('sessionHeaderOf title', () => {
  it('takes the live title from the sessions feed', () => {
    expect(headerOf({ summary: summaryOf({}), fallbackTitle: 'Old' }).title).toBe(
      'Fix the flaky spec',
    )
  })

  it('falls back to the title the list passed while the feed loads', () => {
    expect(headerOf({ fallbackTitle: 'From the list' }).title).toBe('From the list')
  })

  it('says Untitled for a listed session with no title yet', () => {
    expect(headerOf({ summary: summaryOf({ title: null }) }).title).toBe(UNTITLED)
  })

  it('stays blank before anything is known', () => {
    expect(headerOf({}).title).toBe('')
  })
})

describe('sessionHeaderOf work line', () => {
  it('carries the pull request of the session row', () => {
    const header = headerOf({
      summary: summaryOf({
        primaryBranch: 'dennis/glass',
        pullRequest: {
          repo: 'dennisofficial/atlas',
          number: 2844,
          url: 'https://github.com/dennisofficial/atlas/pull/2844',
          state: 'open',
          checks: null,
          mergeable: null,
        },
      }),
    })
    expect(header.work).toMatchObject({
      kind: EWorkKind.PullRequest,
      pullRequest: { number: 2844 },
    })
  })

  it('falls back to the branch when the session has no pull request', () => {
    expect(headerOf({ summary: summaryOf({ primaryBranch: 'dennis/glass' }) }).work).toEqual({
      kind: EWorkKind.Branch,
      branch: 'dennis/glass',
    })
  })

  it('shows no work line before the feed row arrives', () => {
    expect(headerOf({ fallbackTitle: 'From the list' }).work).toEqual({
      kind: EWorkKind.Branch,
      branch: null,
    })
  })
})
