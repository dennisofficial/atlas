import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../generated/prisma/client'
import type { EventDraftDto } from './sessions.dto'

vi.mock('../../db', async () => {
  const { fakeSessionDb } = await import('../../../test/fake-session-db.js')
  return { db: fakeSessionDb().db as unknown as PrismaClient }
})

import { fakeSessionDb } from '../../../test/fake-session-db.js'
import { EventsService } from './events.service'

const USER_A = 'user-a'
const USER_B = 'user-b'

const draft = (type: string, body: Record<string, unknown> = {}): EventDraftDto => ({
  type,
  body: JSON.stringify({ type, ...body }),
})

const contextDraft = (slot: string, key: string, digest: string): EventDraftDto => ({
  type: 'context-loaded',
  body: JSON.stringify({ type: 'context-loaded', slot, key, content: digest }),
  contextSlot: slot,
  contextKey: key,
  contextDigest: digest,
})

describe('EventsService', () => {
  const fake = fakeSessionDb()
  let service: EventsService

  beforeEach(() => {
    fake.reset()
    service = new EventsService()
  })

  it('append claims a missing thread for the caller and stamps sequential seqs', async () => {
    const events = await service.append({
      userId: USER_A,
      threadId: 'brn_one',
      draft: { runId: 'run_1', drafts: [draft('user-said'), draft('assistant-said')] },
    })

    expect(events.map((event) => event.seq)).toEqual([1, 2])
    expect(events[0]?.id).toMatch(/^evt_/)
    expect(fake.threads[0]).toMatchObject({ id: 'brn_one', userId: USER_A, head: 2 })
  })

  it('append refuses a thread owned by another user', async () => {
    await service.append({
      userId: USER_A,
      threadId: 'brn_one',
      draft: { runId: 'run_1', drafts: [draft('user-said')] },
    })

    await expect(
      service.append({
        userId: USER_B,
        threadId: 'brn_one',
        draft: { runId: 'run_2', drafts: [draft('user-said')] },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(fake.events).toHaveLength(1)
  })

  it('a repeated context-loaded draft resolves to the stored event instead of duplicating it', async () => {
    const first = await service.append({
      userId: USER_A,
      threadId: 'brn_one',
      draft: { runId: 'run_1', drafts: [contextDraft('file', 'CLAUDE.md', 'digest-1')] },
    })

    const second = await service.append({
      userId: USER_A,
      threadId: 'brn_one',
      draft: {
        runId: 'run_2',
        drafts: [draft('user-said'), contextDraft('file', 'CLAUDE.md', 'digest-1')],
      },
    })

    expect(fake.events).toHaveLength(2)
    expect(second[1]).toEqual(first[0])
    expect((await service.head({ userId: USER_A, threadId: 'brn_one' })).head).toBe(2)
  })

  it('identical context drafts within one batch share a single fresh row', async () => {
    const events = await service.append({
      userId: USER_A,
      threadId: 'brn_one',
      draft: {
        runId: 'run_1',
        drafts: [contextDraft('file', 'a', 'd'), contextDraft('file', 'a', 'd')],
      },
    })

    expect(fake.events).toHaveLength(1)
    expect(events[0]?.id).toBe(events[1]?.id)
  })

  it('read folds a reference fork parent prefix; readOwn does not', async () => {
    fake.threads.push({
      id: 'brn_parent',
      title: null,
      head: 3,
      createdAt: '2026-09-15T00:00:00.000Z',
      updatedAt: '2026-09-15T00:00:00.000Z',
      parentThreadId: null,
      forkSeq: null,
      forkMode: null,
      spawnerThreadId: null,
      agentType: null,
      workspace: null,
      repo: null,
      modelRef: null,
      modelEffort: null,
      executionLocation: null,
      userId: USER_A,
    })
    fake.threads.push({
      id: 'brn_child',
      title: null,
      head: 3,
      createdAt: '2026-09-15T00:01:00.000Z',
      updatedAt: '2026-09-15T00:01:00.000Z',
      parentThreadId: 'brn_parent',
      forkSeq: 2,
      forkMode: 'reference',
      spawnerThreadId: null,
      agentType: null,
      workspace: null,
      repo: null,
      modelRef: null,
      modelEffort: null,
      executionLocation: null,
      userId: USER_A,
    })
    const parentEvent = (seq: number) => ({
      id: `evt_p${seq}`,
      threadId: 'brn_parent',
      seq,
      runId: 'run_p',
      parentRunId: null,
      depth: 0,
      at: '2026-09-15T00:00:00.000Z',
      type: 'user-said',
      body: '{}',
      contextSlot: null,
      contextKey: null,
      contextDigest: null,
      userId: USER_A,
    })
    fake.events.push(parentEvent(1), parentEvent(2), parentEvent(3))
    fake.events.push({ ...parentEvent(3), id: 'evt_c3', threadId: 'brn_child' })

    const composed = await service.read({ userId: USER_A, threadId: 'brn_child' })
    expect(composed.map((event) => event.id)).toEqual(['evt_p1', 'evt_p2', 'evt_c3'])

    const own = await service.readOwn({ userId: USER_A, threadId: 'brn_child' })
    expect(own.map((event) => event.id)).toEqual(['evt_c3'])
  })

  it('read caps at upTo across the fork chain', async () => {
    await service.append({
      userId: USER_A,
      threadId: 'brn_one',
      draft: { runId: 'run_1', drafts: [draft('user-said'), draft('assistant-said')] },
    })

    const capped = await service.read({ userId: USER_A, threadId: 'brn_one', upTo: 1 })
    expect(capped.map((event) => event.seq)).toEqual([1])
  })

  it('head and reads answer not-found for another user', async () => {
    await service.append({
      userId: USER_A,
      threadId: 'brn_one',
      draft: { runId: 'run_1', drafts: [draft('user-said')] },
    })

    await expect(service.head({ userId: USER_B, threadId: 'brn_one' })).rejects.toBeInstanceOf(
      NotFoundException,
    )
    await expect(service.read({ userId: USER_B, threadId: 'brn_one' })).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })
})
