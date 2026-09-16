import { NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../generated/prisma/client'

vi.mock('../../db', async () => {
  const { fakeSessionDb } = await import('../../../test/fake-session-db.js')
  return { db: fakeSessionDb().db as unknown as PrismaClient }
})

import { fakeSessionDb } from '../../../test/fake-session-db.js'
import { ThreadsService } from './threads.service'

const USER_A = 'user-a'
const USER_B = 'user-b'

describe('ThreadsService', () => {
  const fake = fakeSessionDb()
  let service: ThreadsService

  beforeEach(() => {
    fake.reset()
    service = new ThreadsService()
  })

  it('create mints a brn_ id and find returns the thread', async () => {
    const created = await service.create({
      userId: USER_A,
      draft: { title: 'first', workspace: '/repo', repo: '/repo' },
    })

    expect(created.id).toMatch(/^brn_/)
    expect(created).toMatchObject({ title: 'first', workspace: '/repo', head: 0 })

    const found = await service.find({ userId: USER_A, threadId: created.id })
    expect(found.id).toBe(created.id)
  })

  it('find scopes to the owning user', async () => {
    const created = await service.create({ userId: USER_A, draft: {} })

    await expect(service.find({ userId: USER_B, threadId: created.id })).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('open creates the thread and its first events atomically', async () => {
    const opened = await service.open({
      userId: USER_A,
      draft: {
        runId: 'run_1',
        title: 'opened',
        drafts: [
          { type: 'user-said', body: JSON.stringify({ type: 'user-said', text: 'hi' }) },
          { type: 'assistant-said', body: JSON.stringify({ type: 'assistant-said' }) },
        ],
      },
    })

    expect(opened.thread.head).toBe(2)
    expect(opened.events.map((event) => event.seq)).toEqual([1, 2])
    expect(opened.events[0]?.threadId).toBe(opened.thread.id)
  })

  it('list scopes to project and user, newest first, and enriches from events', async () => {
    const one = await service.create({
      userId: USER_A,
      draft: { workspace: '/repo', title: 'one' },
    })
    await service.create({ userId: USER_A, draft: { workspace: '/other', title: 'two' } })
    await service.create({ userId: USER_B, draft: { workspace: '/repo', title: 'three' } })

    fake.events.push({
      id: 'evt_w1',
      threadId: one.id,
      seq: 1,
      runId: 'run_1',
      parentRunId: null,
      depth: 0,
      at: '2026-09-15T00:00:00.000Z',
      type: 'worktree-entered',
      body: JSON.stringify({ path: '/repo/.atlas/worktrees/one', branch: 'dennis/one' }),
      contextSlot: null,
      contextKey: null,
      contextDigest: null,
      userId: USER_A,
    })
    fake.events.push({
      id: 'evt_p1',
      threadId: one.id,
      seq: 2,
      runId: 'run_1',
      parentRunId: null,
      depth: 0,
      at: '2026-09-15T00:00:01.000Z',
      type: 'pull-request-linked',
      body: JSON.stringify({
        number: 421,
        url: 'https://github.com/x/y/pull/421',
        repo: 'x/y',
        branch: 'dennis/one',
      }),
      contextSlot: null,
      contextKey: null,
      contextDigest: null,
      userId: USER_A,
    })

    const listed = await service.list({ userId: USER_A, project: '/repo' })

    expect(listed.map((thread) => thread.title)).toEqual(['one'])
    expect(listed[0]?.worktree).toEqual({
      path: '/repo/.atlas/worktrees/one',
      branch: 'dennis/one',
    })
    expect(listed[0]?.pullRequests?.[0]?.number).toBe(421)
  })

  it('mostRecent answers the freshest thread in the project', async () => {
    await service.create({ userId: USER_A, draft: { workspace: '/repo', title: 'old' } })
    const fresh = await service.create({
      userId: USER_A,
      draft: { workspace: '/repo', title: 'fresh' },
    })
    fake.threads[0]!.updatedAt = '2026-09-14T00:00:00.000Z'
    fake.threads[1]!.updatedAt = '2026-09-15T00:00:00.000Z'

    const recent = await service.mostRecent({ userId: USER_A, project: '/repo' })
    expect(recent?.id).toBe(fresh.id)
  })

  it('rename, chooseModel, chooseLocation and adopt write their fields', async () => {
    const created = await service.create({ userId: USER_A, draft: {} })

    await service.rename({ userId: USER_A, threadId: created.id, draft: { title: 'renamed' } })
    await service.chooseModel({
      userId: USER_A,
      threadId: created.id,
      draft: { ref: 'anthropic/claude-opus', effort: 'high' },
    })
    await service.chooseLocation({
      userId: USER_A,
      threadId: created.id,
      draft: { location: 'cloud' },
    })
    await service.adopt({
      userId: USER_A,
      threadId: created.id,
      draft: { workspace: '/adopted', repo: null },
    })

    const found = await service.find({ userId: USER_A, threadId: created.id })
    expect(found).toMatchObject({
      title: 'renamed',
      workspace: '/adopted',
      repo: null,
      model: { ref: 'anthropic/claude-opus', effort: 'high' },
      executionLocation: 'cloud',
    })
  })

  it('spawned lists child threads of an owned thread only', async () => {
    const parent = await service.create({ userId: USER_A, draft: {} })
    await service.open({
      userId: USER_A,
      draft: {
        runId: 'run_1',
        drafts: [{ type: 'agent-started', body: '{}' }],
        agent: { spawnedBy: parent.id, type: 'explore' },
      },
    })

    const spawned = await service.spawned({ userId: USER_A, threadId: parent.id })
    expect(spawned).toHaveLength(1)
    expect(spawned[0]?.agent).toEqual({ spawnedBy: parent.id, type: 'explore' })

    await expect(
      service.spawned({ userId: USER_B, threadId: parent.id }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})
