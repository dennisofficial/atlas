import { describe, expect, it } from 'bun:test'
import {
  EGrantScope,
  ERiskDimension,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type EventDraft,
} from '@dltech/atlas-core'
import { EClientFrame, EClientRequest } from '@dltech/atlas-harness'

import { answerGrantRequest, isGrantOp, type ServeGrants } from '../grant-requests'
import type { RequestFrame } from '../request-reply'

const threadId = toThreadId('thread-grants')

const granted = (grantId: string, seq: number): Event =>
  ({
    type: 'permission-granted',
    grantId,
    dimensions: [ERiskDimension.Reach],
    scope: EGrantScope.Thread,
    subject: 'curl',
    reason: 'fetching docs',
    id: toEventId(`ev-${seq}`),
    seq,
    threadId,
    runId: toRunId('run-0'),
    depth: 0,
    at: '2026-10-29T00:00:00.000Z',
  }) as Event

const fixture = (stored: Event[]) => {
  const appended: EventDraft[] = []
  let changes = 0
  const grants: ServeGrants = {
    log: {
      read: async () => stored,
      append: async ({ drafts }) => {
        appended.push(...drafts)
        return []
      },
    },
    ids: { nextRunId: () => toRunId('run-revoke') },
    changed: () => {
      changes += 1
    },
  }
  return { grants, appended, changes: () => changes }
}

const frameOf = (params: unknown): RequestFrame => ({
  kind: EClientFrame.Request,
  id: 'req-1',
  op: EClientRequest.RevokeGrant,
  params,
})

describe('revoke-grant', () => {
  it('classifies the op', () => {
    expect(isGrantOp(EClientRequest.RevokeGrant)).toBe(true)
    expect(isGrantOp(EClientRequest.ReadEvents)).toBe(false)
  })

  it('appends permission-revoked for an active grant and signals', async () => {
    const { grants, appended, changes } = fixture([granted('g-1', 1)])
    const reply = await answerGrantRequest({
      frame: frameOf({ threadId: 'thread-grants', grantId: 'g-1' }),
      threadId,
      grants,
    })
    expect(reply.ok).toBe(true)
    expect(reply.data).toEqual({ revoked: true })
    expect(appended).toEqual([{ type: 'permission-revoked', grantId: 'g-1' }])
    expect(changes()).toBe(1)
  })

  it('answers revoked:false and appends nothing for an unknown grant', async () => {
    const { grants, appended, changes } = fixture([granted('g-1', 1)])
    const reply = await answerGrantRequest({
      frame: frameOf({ threadId: 'thread-grants', grantId: 'nope' }),
      threadId,
      grants,
    })
    expect(reply.data).toEqual({ revoked: false })
    expect(appended).toEqual([])
    expect(changes()).toBe(0)
  })

  it('answers revoked:false for an already revoked grant', async () => {
    const revoked = {
      type: 'permission-revoked',
      grantId: 'g-1',
      seq: 2,
    } as Event
    const { grants, appended } = fixture([granted('g-1', 1), revoked])
    const reply = await answerGrantRequest({
      frame: frameOf({ threadId: 'thread-grants', grantId: 'g-1' }),
      threadId,
      grants,
    })
    expect(reply.data).toEqual({ revoked: false })
    expect(appended).toEqual([])
  })

  it('refuses malformed params', async () => {
    const { grants } = fixture([])
    const reply = await answerGrantRequest({
      frame: frameOf({ grantId: 'g-1' }),
      threadId,
      grants,
    })
    expect(reply.ok).toBe(false)
  })

  it('refuses a thread this serve does not hold', async () => {
    const { grants, appended } = fixture([granted('g-1', 1)])
    const reply = await answerGrantRequest({
      frame: frameOf({ threadId: 'other-thread', grantId: 'g-1' }),
      threadId,
      grants,
    })
    expect(reply.ok).toBe(false)
    expect(appended).toEqual([])
  })
})
