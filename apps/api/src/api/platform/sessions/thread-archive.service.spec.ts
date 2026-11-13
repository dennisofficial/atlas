import { NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import type { AnyTask } from '@trigger.dev/sdk'
import { JobDispatcher, type JobDispatch } from '../../../_core/ports/job-dispatcher'
import { db } from '@dltech/atlas-db'
import type { SandboxCredentials } from '../../../_core/ports/sandbox-credentials'
import {
  seedSandboxRow,
  seedThreadRow,
  seedUsers,
  sessionOfThreadRow,
  threadById,
  USER_A,
  USER_B,
  STAMP,
} from '../../../../test/session-seed'
import { VercelSandboxClient } from '../sandboxes/vercel-sandbox.client'
import { THREAD_ARCHIVE_CLEANUP_TASK_ID } from './thread-archive-cleanup.contract'
import { inertTeammateStop } from './teammate-archive-stop.fixture'
import { TeammateArchiveStopService } from './teammate-archive-stop'
import { inertSignals } from './thread-signals.fixture'
import { ThreadArchiveService } from './thread-archive.service'
import type { SandboxesService } from '../sandboxes/sandboxes.service'

class FakeDispatcher extends JobDispatcher {
  readonly calls: JobDispatch<AnyTask>[] = []
  failure: Error | null = null

  async dispatch<TTask extends AnyTask>(args: JobDispatch<TTask>): Promise<{ runId: string }> {
    if (this.failure !== null) throw this.failure
    this.calls.push(args)
    return { runId: 'run_1' }
  }
}

const neverLookedUp: SandboxCredentials = {
  forThread: () => Promise.reject(new Error('a spec never reaches Vercel credentials')),
  forUser: () => Promise.reject(new Error('a spec never reaches Vercel credentials')),
}

const teammateStopWith = (
  stopTeammate: (args: { threadId: string; name: string; agentId: string }) => Promise<void>,
): TeammateArchiveStopService => {
  const vercel = new VercelSandboxClient(neverLookedUp)
  vercel.stopTeammate = stopTeammate
  return new TeammateArchiveStopService(vercel, inertSignals())
}

const seedRunningTeammate = async () => {
  await seedThreadRow({ id: 'brn_lead' })
  await seedSandboxRow({ threadId: 'brn_lead' })
  await db.orm.public.SandboxBootStep.create({
    sessionId: 'ses_brn_lead',
    step: 'provision',
    state: 'done',
  })
  await seedThreadRow({ id: 'brn_mate', managedBySessionId: 'ses_brn_lead' })
}

describe('ThreadArchiveService', () => {
  useTestDatabase()
  let dispatcher: FakeDispatcher
  let service: ThreadArchiveService

  beforeEach(async () => {
    await seedUsers(USER_A, USER_B)
    await seedThreadRow({ id: 'thr_1' })
    dispatcher = new FakeDispatcher()
    service = new ThreadArchiveService(dispatcher, inertSignals(), inertTeammateStop())
  })

  it('archives without touching updatedAt and dispatches the cleanup once', async () => {
    await service.setArchived({ userId: USER_A, threadId: 'thr_1', archived: true })

    const row = await threadById('thr_1')
    const session = await sessionOfThreadRow('thr_1')
    expect(session?.archivedAt).toBeInstanceOf(Date)
    expect(row?.updatedAt.getTime()).toBe(STAMP.getTime())
    const archivedAt = session?.archivedAt?.toISOString() ?? ''
    expect(dispatcher.calls).toHaveLength(1)
    expect(dispatcher.calls[0]).toMatchObject({
      task: { id: THREAD_ARCHIVE_CLEANUP_TASK_ID },
      payload: { threadId: 'thr_1', archivedAt },
      idempotencyKey: `thread-archive-cleanup:thr_1:${archivedAt}`,
    })
  })

  it('leaves the pod park to the dispatched cleanup instead of the response', async () => {
    await seedSandboxRow({ threadId: 'thr_1' })
    const parked: string[] = []
    const sandboxes = {
      park: async (args: { row: { name: string } }) => {
        parked.push(args.row.name)
      },
    } as unknown as SandboxesService
    service = new ThreadArchiveService(
      dispatcher,
      inertSignals(),
      inertTeammateStop(),
      undefined,
      sandboxes,
    )

    await service.setArchived({ userId: USER_A, threadId: 'thr_1', archived: true })

    expect(parked).toEqual([])
    expect(dispatcher.calls).toHaveLength(1)
  })

  it('parks the pod itself when the cleanup dispatch fails', async () => {
    await seedSandboxRow({ threadId: 'thr_1' })
    dispatcher.failure = new Error('trigger is down')
    const parked: string[] = []
    const sandboxes = {
      park: async (args: { row: { name: string } }) => {
        parked.push(args.row.name)
      },
    } as unknown as SandboxesService
    service = new ThreadArchiveService(
      dispatcher,
      inertSignals(),
      inertTeammateStop(),
      undefined,
      sandboxes,
    )

    await service.setArchived({ userId: USER_A, threadId: 'thr_1', archived: true })

    expect(parked).toEqual(['atlas-thread-thr_1'])
    expect((await sessionOfThreadRow('thr_1'))?.archivedAt).toBeInstanceOf(Date)
  })

  it('keeps the archive when the dispatch fails and the pod cannot be parked', async () => {
    await seedSandboxRow({ threadId: 'thr_1' })
    dispatcher.failure = new Error('trigger is down')
    const sandboxes = {
      park: async () => {
        throw new Error('pod gone')
      },
    } as unknown as SandboxesService
    service = new ThreadArchiveService(
      dispatcher,
      inertSignals(),
      inertTeammateStop(),
      undefined,
      sandboxes,
    )

    await service.setArchived({ userId: USER_A, threadId: 'thr_1', archived: true })

    expect((await sessionOfThreadRow('thr_1'))?.archivedAt).toBeInstanceOf(Date)
  })

  it('unarchives by clearing archivedAt and dispatches nothing', async () => {
    await seedThreadRow({ id: 'thr_2', archivedAt: STAMP })

    await service.setArchived({ userId: USER_A, threadId: 'thr_2', archived: false })

    const row = await threadById('thr_2')
    expect((await sessionOfThreadRow('thr_2'))?.archivedAt).toBeNull()
    expect(row?.updatedAt.getTime()).toBe(STAMP.getTime())
    expect(dispatcher.calls).toHaveLength(0)
  })

  it('answers not found for another user thread and leaves it untouched', async () => {
    await expect(
      service.setArchived({ userId: USER_B, threadId: 'thr_1', archived: true }),
    ).rejects.toBeInstanceOf(NotFoundException)

    expect((await sessionOfThreadRow('thr_1'))?.archivedAt).toBeNull()
    expect(dispatcher.calls).toHaveLength(0)
  })

  it('keeps the thread archived when the dispatch fails', async () => {
    dispatcher.failure = new Error('trigger is down')

    await service.setArchived({ userId: USER_A, threadId: 'thr_1', archived: true })

    expect((await sessionOfThreadRow('thr_1'))?.archivedAt).toBeInstanceOf(Date)
  })

  it('refuses to archive a running teammate whose stop fails', async () => {
    await seedRunningTeammate()
    service = new ThreadArchiveService(
      dispatcher,
      inertSignals(),
      teammateStopWith(() => Promise.reject(new Error('pod gone'))),
    )

    await expect(
      service.setArchived({ userId: USER_A, threadId: 'brn_mate', archived: true }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException)

    expect((await sessionOfThreadRow('brn_mate'))?.archivedAt).toBeNull()
    expect(dispatcher.calls).toHaveLength(0)
  })

  it('stops a running teammate first and then archives it', async () => {
    await seedRunningTeammate()
    const stops: string[] = []
    service = new ThreadArchiveService(
      dispatcher,
      inertSignals(),
      teammateStopWith(async ({ agentId }) => {
        stops.push(agentId)
      }),
    )

    await service.setArchived({ userId: USER_A, threadId: 'brn_mate', archived: true })

    expect(stops).toEqual(['brn_mate'])
    expect((await sessionOfThreadRow('brn_mate'))?.archivedAt).toBeInstanceOf(Date)
    expect(dispatcher.calls).toHaveLength(1)
    expect((await sessionOfThreadRow('brn_lead'))?.archivedAt).toBeNull()
  })
})
