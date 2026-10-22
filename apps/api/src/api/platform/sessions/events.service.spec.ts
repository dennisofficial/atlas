import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  eventsOf,
  seedEventRow,
  seedThreadRow,
  seedUsers,
  threadById,
  USER_A,
  USER_B,
} from '../../../../test/session-seed'
import type { EventDraftDto } from './sessions.dto'
import { EventsService } from './events.service'

const allEvents = () => db.orm.public.Event.all()

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
  useTestDatabase()
  let service: EventsService

  beforeEach(async () => {
    await seedUsers(USER_A, USER_B)
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
    expect(await threadById('brn_one')).toMatchObject({ id: 'brn_one', userId: USER_A, head: 2 })
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
    expect(await allEvents()).toHaveLength(1)
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

    expect(await allEvents()).toHaveLength(2)
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

    expect(await allEvents()).toHaveLength(1)
    expect(events[0]?.id).toBe(events[1]?.id)
  })

  it('read folds a reference fork parent prefix; readOwn does not', async () => {
    await seedThreadRow({ id: 'brn_parent', head: 3 })
    await seedThreadRow({
      id: 'brn_child',
      head: 3,
      createdAt: new Date('2026-09-15T00:01:00.000Z'),
      updatedAt: new Date('2026-09-15T00:01:00.000Z'),
      parentThreadId: 'brn_parent',
      forkSeq: 2,
      forkMode: 'reference',
    })
    for (const seq of [1, 2, 3]) {
      await seedEventRow({ id: `evt_p${seq}`, threadId: 'brn_parent', seq, runId: 'run_p' })
    }
    await seedEventRow({ id: 'evt_c3', threadId: 'brn_child', seq: 3, runId: 'run_p' })

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

  describe('replace', () => {
    it('replaces the log wholesale, dropping old rows and reseqing 1..N', async () => {
      await service.append({
        userId: USER_A,
        threadId: 'brn_one',
        draft: { runId: 'run_1', drafts: [draft('user-said'), draft('assistant-said')] },
      })
      const oldIds = (await eventsOf('brn_one')).map((event) => event.id)

      const replaced = await service.replace({
        userId: USER_A,
        threadId: 'brn_one',
        draft: {
          runId: 'run_2',
          drafts: [draft('user-said'), draft('assistant-said'), draft('tool-called')],
        },
      })

      expect(replaced.map((event) => event.seq)).toEqual([1, 2, 3])
      expect(replaced.every((event) => event.runId === 'run_2')).toBe(true)
      const stored = await eventsOf('brn_one')
      expect(stored).toHaveLength(3)
      expect(stored.map((event) => event.id)).not.toEqual(expect.arrayContaining(oldIds))
      expect(await threadById('brn_one')).toMatchObject({ id: 'brn_one', head: 3 })
    })

    it('does not dedup identical context drafts the way append does', async () => {
      await service.append({
        userId: USER_A,
        threadId: 'brn_one',
        draft: { runId: 'run_0', drafts: [draft('user-said')] },
      })

      const replaced = await service.replace({
        userId: USER_A,
        threadId: 'brn_one',
        draft: {
          runId: 'run_1',
          drafts: [contextDraft('file', 'a', 'd'), contextDraft('file', 'b', 'd')],
        },
      })

      expect(await allEvents()).toHaveLength(2)
      expect(replaced[0]?.id).not.toBe(replaced[1]?.id)
      expect(replaced.map((event) => event.seq)).toEqual([1, 2])
    })

    it('refuses a thread belonging to another user', async () => {
      await service.append({
        userId: USER_A,
        threadId: 'brn_one',
        draft: { runId: 'run_1', drafts: [draft('user-said')] },
      })

      await expect(
        service.replace({
          userId: USER_B,
          threadId: 'brn_one',
          draft: { runId: 'run_2', drafts: [draft('user-said')] },
        }),
      ).rejects.toBeInstanceOf(ForbiddenException)
      expect(await allEvents()).toHaveLength(1)
    })

    it('404s on a missing thread rather than creating one', async () => {
      await expect(
        service.replace({
          userId: USER_A,
          threadId: 'brn_missing',
          draft: { runId: 'run_1', drafts: [draft('user-said')] },
        }),
      ).rejects.toBeInstanceOf(NotFoundException)
      expect(await db.orm.public.Thread.all()).toHaveLength(0)
    })

    it('empties the log and zeroes head when given no drafts', async () => {
      await service.append({
        userId: USER_A,
        threadId: 'brn_one',
        draft: { runId: 'run_1', drafts: [draft('user-said'), draft('assistant-said')] },
      })

      const replaced = await service.replace({
        userId: USER_A,
        threadId: 'brn_one',
        draft: { runId: 'run_2', drafts: [] },
      })

      expect(replaced).toEqual([])
      expect(await allEvents()).toHaveLength(0)
      expect(await threadById('brn_one')).toMatchObject({ id: 'brn_one', head: 0 })
    })
  })
})
