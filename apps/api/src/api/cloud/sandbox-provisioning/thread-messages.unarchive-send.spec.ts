import { EThreadMessageState } from '@dltech/atlas-wire'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedUsers } from '../../../../test/session-seed'
import { recordingSweepDeps, seedArchivedApiSession } from './archived-sandbox-sweep.fixture'
import { sweepArchivedSandboxes } from './archived-sandbox-sweep'
import { eventsOf, messagesWith, sandboxRows, sessionRow } from './sandbox-provisioning.fixture'

const ARGS = { userId: 'usr-1', threadId: 'thr-1', sendId: 'snd-1', text: 'hello' } as const

const EIGHT_DAYS_AGO = new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000)

describe('ThreadMessagesService.send after the archived-sandbox sweep deleted the pod', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers('usr-1')
  })

  it('unarchives the session and boots a fresh sandbox', async () => {
    await seedArchivedApiSession({ archivedAt: EIGHT_DAYS_AGO })
    const swept = await sweepArchivedSandboxes({ now: new Date(), deps: recordingSweepDeps().deps })
    expect(swept.deleted).toBe(1)
    expect(await sandboxRows()).toHaveLength(0)

    const { service, dispatch } = messagesWith()
    const reply = await service.send(ARGS)

    expect(reply).toEqual({ state: EThreadMessageState.Queued })
    expect((await sessionRow())?.archivedAt).toBeNull()
    expect(await eventsOf()).toHaveLength(1)
    expect(await sandboxRows()).toHaveLength(1)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
})
