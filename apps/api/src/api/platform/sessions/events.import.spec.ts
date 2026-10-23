import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { POD_EVENT_CONFLICT_CODE, type PodEvent } from '@dltech/atlas-wire'
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
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { EventsController } from './events.controller'
import { EventsService } from './events.service'

const AT = '2026-10-22T10:00:00.000Z'
const eventAt = (seq: number, extra: Partial<PodEvent> = {}): PodEvent => ({
  seq,
  runId: 'run_local',
  depth: 0,
  at: AT,
  type: 'assistant-said',
  body: JSON.stringify({ type: 'assistant-said', seq }),
  ...extra,
})

describe('importing a local mirror into a thread', () => {
  useTestDatabase()
  let service: EventsService

  beforeEach(async () => {
    await seedUsers(USER_A, USER_B)
    await seedThreadRow({ id: 'thr-1', userId: USER_A, head: 3 })
    for (const seq of [1, 2, 3]) {
      await seedEventRow({
        threadId: 'thr-1',
        seq,
        runId: 'run_local',
        type: 'assistant-said',
        body: eventAt(seq).body,
        at: new Date(AT),
      })
    }
    service = new EventsService()
  })

  it('skips the seqs Postgres already holds identically and stores the rest', async () => {
    const reply = await service.importEvents({
      userId: USER_A,
      threadId: 'thr-1',
      events: [1, 2, 3, 4, 5, 6].map((seq) => eventAt(seq)),
    })

    expect(reply).toEqual({ head: 6 })
    expect((await eventsOf('thr-1')).map((row) => row.seq)).toEqual([1, 2, 3, 4, 5, 6])
    expect((await threadById('thr-1'))?.head).toBe(6)
  })

  it('answers 409 and writes nothing when a held seq differs', async () => {
    const failure = await service
      .importEvents({
        userId: USER_A,
        threadId: 'thr-1',
        events: [eventAt(4), eventAt(2, { body: '{"type":"assistant-said","other":true}' })],
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      )

    expect(failure).toBeInstanceOf(ConflictException)
    expect((failure as ConflictException).getResponse()).toMatchObject({
      code: POD_EVENT_CONFLICT_CODE,
      seq: 2,
    })
    expect((await eventsOf('thr-1')).map((row) => row.seq)).toEqual([1, 2, 3])
    expect((await threadById('thr-1'))?.head).toBe(3)
  })

  it('accepts a gap above the head and moves the head to the highest seq', async () => {
    const reply = await service.importEvents({
      userId: USER_A,
      threadId: 'thr-1',
      events: [eventAt(7), eventAt(9)],
    })

    expect(reply).toEqual({ head: 9 })
    expect((await eventsOf('thr-1')).map((row) => row.seq)).toEqual([1, 2, 3, 7, 9])
  })

  it("answers 404 for another user's thread and writes nothing", async () => {
    await expect(
      service.importEvents({ userId: USER_B, threadId: 'thr-1', events: [eventAt(4)] }),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(await eventsOf('thr-1')).toHaveLength(3)
  })

  it('refuses a sandbox principal: only the owner session imports', async () => {
    const controller = new EventsController(service)
    const request = {
      auth: { userId: USER_A, sessionId: 'sandbox:1', email: '', activeOrganizationId: null },
      sandbox: { sandboxId: 'sbx-1', threadId: 'thr-1' },
    } as unknown as AuthenticatedRequest

    await expect(
      controller.handleImport(request, 'thr-1', { events: [eventAt(4)] }),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(await eventsOf('thr-1')).toHaveLength(3)
  })
})
