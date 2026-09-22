import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeFactoryDb } = await import('../../../../test/fake-factory-db.js')
  return { db: fakeFactoryDb().db as unknown as PrismaClient }
})

import { fakeFactoryDb } from '../../../../test/fake-factory-db.js'
import type { SandboxesService } from '../../platform/sandboxes/sandboxes.service'
import type { ThreadsService } from '../../platform/sessions/threads.service'
import type { FactoryDrivesService } from '../drives/drives.service'
import { DEFAULT_ORGANIZATION_ID } from '../factory.types'
import type { FactoryCredentialService } from '../orchestrator/factory-credentials'
import { FactoryIdentityService } from '../orchestrator/factory-identity'
import type { OrchestratorChannel } from '../orchestrator/orchestrator-channel'
import { TranscriptService } from '../transcript.service'
import { WorkItemsService } from '../work-items.service'
import { EStationRunStatus } from './station.types'
import { StationsService } from './stations.service'
import { stubFactoryChannel, stubFactorySandboxes } from './stations.service.spec'

const INTAKE = {
  organizationId: DEFAULT_ORGANIZATION_ID,
  repo: 'dennisofficial/factory-scratch',
  sourceKind: 'github',
  surface: 'github',
  externalId: 'dennisofficial/factory-scratch#12',
  aliasKind: 'issue',
}

describe('StationsService lifecycle', () => {
  const fake = fakeFactoryDb()
  let workItems: WorkItemsService
  let sandboxes: ReturnType<typeof stubFactorySandboxes>
  let channel: { inject: ReturnType<typeof vi.fn> }
  let service: StationsService

  const spawnOrchestrated = async () => {
    const { workItem } = await workItems.intake(INTAKE)
    fake.workItems[0]!.orchestratorThreadId = 'brn_orchestrator_1'
    return workItem
  }

  const spawn = (message = 'implement the thing') =>
    service.spawn({ orchestratorThreadId: 'brn_orchestrator_1', kind: 'implementer', message })

  const flushSpawn = async () => {
    await vi.waitFor(() => expect(channel.inject).toHaveBeenCalled())
  }

  beforeEach(() => {
    fake.reset()
    workItems = new WorkItemsService()
    sandboxes = stubFactorySandboxes()
    channel = stubFactoryChannel(fake)
    const threads = {
      create: vi.fn(async () => {
        const id = `brn_station_${fake.threads.length + 1}`
        fake.threads.push({ id, head: 0 })
        return { id }
      }),
    }
    const credentials = {
      ensureSeeded: vi.fn(async () => undefined),
      modelRef: vi.fn(() => 'inference/kimi-k3-fast'),
    }
    const drives = { ensure: vi.fn(async () => 'factory-dennisofficial-factory-scratch-12') }
    service = new StationsService(
      workItems,
      new TranscriptService(),
      threads as unknown as ThreadsService,
      sandboxes as unknown as SandboxesService,
      new FactoryIdentityService(),
      credentials as unknown as FactoryCredentialService,
      drives as unknown as FactoryDrivesService,
      channel as OrchestratorChannel,
    )
  })

  describe('steer and stop', () => {
    const spawnAndGetRun = async () => {
      await spawnOrchestrated()
      const spawned = await spawn()
      await flushSpawn()
      const run = fake.stationRuns[0]
      if (run === undefined) throw new Error('missing run')
      return { spawned, run }
    }

    it('steers a running station with a marked message', async () => {
      const { spawned, run } = await spawnAndGetRun()
      channel.inject.mockClear()
      const steered = await service.steer({
        orchestratorThreadId: 'brn_orchestrator_1',
        runId: spawned.stationRunId,
        message: 'also cover the edge case',
      })
      expect(steered.steered).toBe(true)
      const text = (channel.inject.mock.calls[0]?.[0] as { text: string }).text
      expect(text).toContain('[station steer]')
      expect(text).toContain('also cover the edge case')
      const event = fake.events.find(
        (one) => one.threadId === run.threadId && one.body.includes('steer:'),
      )
      expect(event).toBeDefined()
    })

    it('refuses to steer a finished run', async () => {
      const { spawned } = await spawnAndGetRun()
      fake.stationRuns[0]!.status = EStationRunStatus.Finished
      await expect(
        service.steer({
          orchestratorThreadId: 'brn_orchestrator_1',
          runId: spawned.stationRunId,
          message: 'too late',
        }),
      ).rejects.toThrow('finished')
    })

    it('stop parks the sandbox and marks the run', async () => {
      const { spawned, run } = await spawnAndGetRun()
      await service.stop({ orchestratorThreadId: 'brn_orchestrator_1', runId: spawned.stationRunId })
      expect(sandboxes.stop).toHaveBeenCalledWith({
        userId: fake.users[0]?.id,
        threadId: run.threadId,
      })
      expect(fake.stationRuns[0]?.status).toBe(EStationRunStatus.Stopped)
    })

    it('refuses steer and stop from a non-orchestrator caller', async () => {
      const { spawned } = await spawnAndGetRun()
      await expect(
        service.steer({
          orchestratorThreadId: 'brn_other',
          runId: spawned.stationRunId,
          message: 'x',
        }),
      ).rejects.toThrow('not the orchestrator')
      await expect(
        service.stop({ orchestratorThreadId: 'brn_other', runId: spawned.stationRunId }),
      ).rejects.toThrow('not the orchestrator')
    })
  })

  describe('stopRunningFor', () => {
    it('stops every running station of the work item and marks them stopped', async () => {
      await spawnOrchestrated()
      await spawn()
      await flushSpawn()

      await service.stopRunningFor({ workItemId: fake.workItems[0]!.id })

      expect(fake.stationRuns[0]?.status).toBe(EStationRunStatus.Stopped)
      expect(sandboxes.stop).toHaveBeenCalledWith({
        userId: fake.users[0]?.id,
        threadId: fake.stationRuns[0]?.threadId,
      })
    })

    it('is a no-op when nothing runs', async () => {
      await spawnOrchestrated()
      await service.stopRunningFor({ workItemId: fake.workItems[0]!.id })
      expect(sandboxes.stop).not.toHaveBeenCalled()
    })
  })
})
