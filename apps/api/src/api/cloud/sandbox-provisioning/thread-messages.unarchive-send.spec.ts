import { NotFoundException } from '@nestjs/common'
import { EThreadMessageState } from '@dltech/atlas-wire'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedUsers } from '../../../../test/session-seed'
import { recordingSweepDeps, seedArchivedApiSession } from './archived-sandbox-sweep.fixture'
import { sweepArchivedSandboxes } from './archived-sandbox-sweep'
import { eventsOf, messagesWith, sandboxRows, sessionRow } from './sandbox-provisioning.fixture'

const ARGS = { userId: 'usr-1', threadId: 'thr-1', sendId: 'snd-1', text: 'hello' } as const

const HOURS = (count: number) => new Date(Date.now() - count * 60 * 60 * 1_000)

describe('ThreadMessagesService.send around the archived-sandbox sweep', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers('usr-1')
  })

  it('unarchives a session still inside the grace and boots a fresh sandbox', async () => {
    await seedArchivedApiSession({ archivedAt: HOURS(2) })
    const swept = await sweepArchivedSandboxes({ now: new Date(), deps: recordingSweepDeps().deps })
    expect(swept.deleted).toBe(0)
    expect((await sessionRow())?.deletedAt).toBeNull()

    const { service, dispatch } = messagesWith()
    const reply = await service.send(ARGS)

    expect(reply).toEqual({ state: EThreadMessageState.Queued })
    expect((await sessionRow())?.archivedAt).toBeNull()
    expect(await eventsOf()).toHaveLength(1)
    expect(await sandboxRows()).toHaveLength(1)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('answers 404 for a session the sweep soft-deleted after the grace', async () => {
    await seedArchivedApiSession({ archivedAt: HOURS(8 * 24) })
    const swept = await sweepArchivedSandboxes({ now: new Date(), deps: recordingSweepDeps().deps })
    expect(swept.retired).toBe(1)
    expect(swept.deleted).toBe(1)
    expect((await sandboxRows())[0]?.retiredAt).not.toBeNull()
    expect((await sessionRow())?.deletedAt).not.toBeNull()

    const { service, dispatch } = messagesWith()
    const failure = await service.send(ARGS).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(NotFoundException)
    expect(await eventsOf()).toHaveLength(0)
    expect(dispatch).not.toHaveBeenCalled()
  })
})
