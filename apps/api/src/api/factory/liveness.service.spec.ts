import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../generated/prisma/client'

vi.mock('../../db', async () => {
  const { fakeFactoryDb } = await import('../../../test/fake-factory-db.js')
  return { db: fakeFactoryDb().db as unknown as PrismaClient }
})

import { fakeFactoryDb } from '../../../test/fake-factory-db.js'
import type { SandboxesService } from '../platform/sandboxes/sandboxes.service'
import type { ThreadsService } from '../platform/sessions/threads.service'
import type { FactoryDrivesService } from './drives/drives.service'
import { DEFAULT_ORGANIZATION_ID, EFactoryEventKind } from './factory.types'
import type { FactoryCredentialService } from './orchestrator/factory-credentials'
import type { SecretCipherService } from '../../_lib/crypto/secret-cipher.service'
import { FactoryIdentityService } from './orchestrator/factory-identity'
import type { OrchestratorChannel } from './orchestrator/orchestrator-channel'
import type { OrchestratorService } from './orchestrator/orchestrator.service'
import { TranscriptService } from './transcript.service'
import { WorkItemsService } from './work-items.service'
import { EStationRunStatus } from './stations/station.types'
import { StationsService } from './stations/stations.service'

const nullCipher = null as unknown as SecretCipherService

const INTAKE = {
  organizationId: DEFAULT_ORGANIZATION_ID,
  repo: 'dennisofficial/factory-scratch',
  sourceKind: 'github',
  surface: 'github',
  externalId: 'dennisofficial/factory-scratch#12',
  aliasKind: 'issue',
}

const SILENCE = 20 * 60 * 1000

describe('StationsService stuck-run detection', () => {
  const fake = fakeFactoryDb()
  let workItems: WorkItemsService
  let orchestrator: { wake: ReturnType<typeof vi.fn> }
  let sandboxes: {
    runningEndpoint: ReturnType<typeof vi.fn>
    attach: ReturnType<typeof vi.fn>
    whenSettled: ReturnType<typeof vi.fn>
    status: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
  }
  let service: StationsService
  let channel: { inject: ReturnType<typeof vi.fn> }
  let workItemId: string

  const seedRun = (args: { updatedAt: string }) => {
    const id = `fsr_${fake.stationRuns.length + 1}`
    fake.stationRuns.push({
      id,
      workItemId,
      kind: 'implementer',
      threadId: `brn_station_${fake.stationRuns.length + 1}`,
      status: EStationRunStatus.Running,
      driveMode: 'read-write',
      createdAt: args.updatedAt,
      updatedAt: args.updatedAt,
      finishedAt: null,
    })
    // Recovery reads the original assignment back out of the spawn's request event.
    fake.transcriptEvents.push({
      id: `evt_req_${id}`,
      workItemId,
      surface: 'github',
      externalId: INTAKE.externalId,
      deliveryId: `station-request:${id}`,
      kind: EFactoryEventKind.StationRequest,
      author: 'atlas-factory',
      payload: JSON.stringify({ runId: id, kind: 'implementer', message: 'implement the thing' }),
      receivedAt: args.updatedAt,
      seq: fake.transcriptEvents.length + 1,
    } as never)
    return fake.stationRuns[fake.stationRuns.length - 1]!
  }

  beforeEach(async () => {
    fake.reset()
    workItems = new WorkItemsService()
    orchestrator = { wake: vi.fn(() => undefined) }
    sandboxes = {
      runningEndpoint: vi.fn(async () => null),
      attach: vi.fn(async () => ({ token: 'tok' })),
      whenSettled: vi.fn(async () => undefined),
      status: vi.fn(async () => ({ name: 'factory-st-x', url: 'https://st-3000.vercel.run' })),
      stop: vi.fn(async () => undefined),
    }
    channel = {
      inject: vi.fn(
        async (args: { threadId: string; text: string; accepted: () => Promise<boolean> }) => {
          fake.events.push({
            id: `evt_${fake.events.length + 1}`,
            threadId: args.threadId,
            seq: fake.events.length + 1,
            type: 'user-said',
            body: JSON.stringify({ type: 'user-said', text: args.text }),
          })
          await args.accepted()
        },
      ),
    }
    const threads = { create: vi.fn(async () => ({ id: 'brn_station_x' })) }
    const credentials = {
      ensureSeeded: vi.fn(async () => undefined),
      modelRef: vi.fn(async () => 'inference/kimi-k3-fast'),
      decisionsUrl: vi.fn(async () => undefined),
    }
    const drives = { ensure: vi.fn(async () => 'factory-drive') }
    service = new StationsService(
      workItems,
      new TranscriptService(),
      threads as unknown as ThreadsService,
      sandboxes as unknown as SandboxesService,
      new FactoryIdentityService(nullCipher),
      credentials as unknown as FactoryCredentialService,
      drives as unknown as FactoryDrivesService,
      channel as OrchestratorChannel,
      orchestrator as unknown as OrchestratorService,
    )
    const { workItem } = await workItems.intake(INTAKE)
    workItemId = workItem.id
    fake.workItems[0]!.orchestratorThreadId = 'brn_orchestrator_1'
  })

  it('fails a run that has been silent past the threshold and has no live endpoint, and wakes the orchestrator', async () => {
    const run = seedRun({ updatedAt: new Date(Date.now() - SILENCE - 1000).toISOString() })

    const failed = await service.failStuckRuns({ silentForMs: SILENCE })

    expect(failed).toBe(1)
    expect(fake.stationRuns[0]?.status).toBe(EStationRunStatus.Failed)
    expect(orchestrator.wake).toHaveBeenCalledWith({
      workItemId,
      externalId: INTAKE.externalId,
    })
    const outcome = fake.transcriptEvents.find(
      (one) => one.deliveryId === `station-outcome:${run.id}:failed`,
    )
    expect(outcome?.kind).toBe(EFactoryEventKind.StationResult)
    expect(JSON.parse(outcome?.payload ?? '{}')).toMatchObject({ runId: run.id, status: 'failed' })
  })

  it('leaves a recent run alone', async () => {
    seedRun({ updatedAt: new Date().toISOString() })

    const failed = await service.failStuckRuns({ silentForMs: SILENCE })

    expect(failed).toBe(0)
    expect(fake.stationRuns[0]?.status).toBe(EStationRunStatus.Running)
    expect(orchestrator.wake).not.toHaveBeenCalled()
  })

  it('leaves a silent run whose sandbox is still live alone', async () => {
    seedRun({ updatedAt: new Date(Date.now() - SILENCE - 1000).toISOString() })
    sandboxes.runningEndpoint.mockResolvedValue({ token: 'tok', url: 'https://st-3000.vercel.run' })

    const failed = await service.failStuckRuns({ silentForMs: SILENCE })

    expect(failed).toBe(0)
    expect(fake.stationRuns[0]?.status).toBe(EStationRunStatus.Running)
    expect(orchestrator.wake).not.toHaveBeenCalled()
  })

  it('recovers a run wedged by a mid-spawn container death instead of failing it', async () => {
    const stale = new Date(Date.now() - SILENCE - 1000).toISOString()
    const run = seedRun({ updatedAt: stale })
    // The wound a dead container leaves: the row was claimed but never stamped past resuming.
    fake.cloudSandboxes.push({ threadId: run.threadId, state: 'resuming' } as never)
    // The detector sees no live endpoint, but the recovery's re-attach brings the sandbox up.
    sandboxes.runningEndpoint
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ token: 'tok', url: 'https://st-3000.vercel.run' })

    const handled = await service.failStuckRuns({ silentForMs: SILENCE })

    expect(handled).toBe(1)
    // Recovered, not failed: the run stays running and the spawn message is re-injected.
    expect(fake.stationRuns[0]?.status).toBe(EStationRunStatus.Running)
    expect(sandboxes.attach).toHaveBeenCalled()
    expect(channel.inject).toHaveBeenCalled()
    expect(channel.inject.mock.calls[0]?.[0].text).toContain(run.id)
    expect(orchestrator.wake).not.toHaveBeenCalled()
  })

  it('fails a silent run whose thread has no sandbox row at all', async () => {
    seedRun({ updatedAt: new Date(Date.now() - SILENCE - 1000).toISOString() })
    sandboxes.runningEndpoint.mockResolvedValue(null)

    const failed = await service.failStuckRuns({ silentForMs: SILENCE })

    expect(failed).toBe(1)
    expect(fake.stationRuns[0]?.status).toBe(EStationRunStatus.Failed)
    expect(orchestrator.wake).toHaveBeenCalled()
  })

  it('fails a wedged run whose recovery itself throws', async () => {
    const stale = new Date(Date.now() - SILENCE - 1000).toISOString()
    const run = seedRun({ updatedAt: stale })
    fake.cloudSandboxes.push({ threadId: run.threadId, state: 'resuming' } as never)
    sandboxes.runningEndpoint.mockResolvedValue(null)
    sandboxes.attach.mockRejectedValue(new Error('vercel is down'))

    const failed = await service.failStuckRuns({ silentForMs: SILENCE })

    expect(failed).toBe(1)
    expect(fake.stationRuns[0]?.status).toBe(EStationRunStatus.Failed)
    expect(orchestrator.wake).toHaveBeenCalled()
  })
})
