import { describe, expect, it } from 'bun:test'
import { EPrEventKind, EPrReviewState, EPrVerdict } from '@dltech/atlas-core'

import { parsePrEventFrame, prEventFrameSchema, prEventNoticeOf, repoOfFrame } from '../pr-event-frame'

const frame = (over: Record<string, unknown> = {}) => ({
  id: 'evt_1',
  repoFullName: 'owner/repo',
  prNumber: 42,
  kind: 'comment',
  payload: { url: 'https://github.com/owner/repo/pull/42#c1', authorLogin: 'octocat', body: 'nit' },
  createdAt: '2026-10-08T00:00:00.000Z',
  ...over,
})

describe('prEventFrameSchema', () => {
  it('accepts every kind in the contract', () => {
    for (const kind of Object.values(EPrEventKind)) {
      expect(prEventFrameSchema.safeParse(frame({ kind })).success).toBe(true)
    }
  })

  it('tolerates additive fields at the top level and in the payload', () => {
    const parsed = prEventFrameSchema.safeParse(
      frame({ extra: 1, payload: { url: 'u', headSha: 'abc', futureField: { nested: true } } }),
    )

    expect(parsed.success).toBe(true)
  })

  it.each([
    ['a missing id', { id: undefined }],
    ['an empty id', { id: '' }],
    ['a missing kind', { kind: undefined }],
    ['an unknown kind', { kind: 'reaction' }],
    ['a non-positive pr number', { prNumber: 0 }],
    ['a missing url', { payload: { body: 'x' } }],
    ['a null optional field', { payload: { url: 'u', body: null } }],
    ['an unknown review state', { kind: 'review', payload: { url: 'u', reviewState: 'dismissed' } }],
    ['an unknown verdict', { kind: 'verdict', payload: { url: 'u', verdict: 'maybe' } }],
  ])('rejects %s', (_, over) => {
    expect(prEventFrameSchema.safeParse(frame(over)).success).toBe(false)
  })
})

describe('prEventNoticeOf', () => {
  it('maps a comment onto the core pr-event draft with a github.com repo', () => {
    const parsed = prEventFrameSchema.parse(frame())

    expect(repoOfFrame(parsed)).toBe('github.com/owner/repo')
    expect(prEventNoticeOf(parsed)).toEqual({
      type: 'pr-event',
      repo: 'github.com/owner/repo',
      prNumber: 42,
      kind: EPrEventKind.Comment,
      url: 'https://github.com/owner/repo/pull/42#c1',
      authorLogin: 'octocat',
      body: 'nit',
    })
  })

  it('carries verdict, mergeability and state only on the kinds that set them', () => {
    const verdict = prEventNoticeOf(
      prEventFrameSchema.parse(frame({ kind: 'verdict', payload: { url: 'u', verdict: 'failed' } })),
    )
    const mergeability = prEventNoticeOf(
      prEventFrameSchema.parse(frame({ kind: 'mergeability', payload: { url: 'u', mergeable: false } })),
    )
    const state = prEventNoticeOf(
      prEventFrameSchema.parse(frame({ kind: 'state', payload: { url: 'u', state: 'merged' } })),
    )

    expect(verdict).toMatchObject({ verdict: EPrVerdict.Failed })
    expect(verdict).not.toHaveProperty('mergeable')
    expect(mergeability).toMatchObject({ mergeable: false })
    expect(state).toMatchObject({ state: 'merged' })
  })

  it('carries a review state and leaves state for the state kind', () => {
    const notice = prEventNoticeOf(
      prEventFrameSchema.parse(
        frame({ kind: 'review', payload: { url: 'u', authorLogin: 'octocat', reviewState: 'approved', headSha: 'abc' } }),
      ),
    )

    expect(notice).toMatchObject({ kind: EPrEventKind.Review, reviewState: EPrReviewState.Approved })
    expect(notice).not.toHaveProperty('state')
    expect(notice).not.toHaveProperty('headSha')
  })
})

describe('parsePrEventFrame', () => {
  it('reports invalid JSON and schema failures instead of throwing', () => {
    expect(parsePrEventFrame({ data: '{nope' })).toEqual({ failure: 'the frame was not JSON' })
    expect(parsePrEventFrame({ data: JSON.stringify(frame({ id: '' })) })).toHaveProperty('failure')
  })

  it('returns the frame on success', () => {
    expect(parsePrEventFrame({ data: JSON.stringify(frame()) })).toHaveProperty('frame.id', 'evt_1')
  })
})
