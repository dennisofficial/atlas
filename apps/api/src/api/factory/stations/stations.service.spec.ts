import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeFactoryDb } = await import('../../../../test/fake-factory-db.js')
  return { db: fakeFactoryDb().db as unknown as PrismaClient }
})

import { fakeFactoryDb } from '../../../../test/fake-factory-db.js'
import type { SandboxesService } from '../../sandboxes/sandboxes.service'
import { ESandboxDriveMode } from '../../sandboxes/sandboxes.types'
import type { ThreadsService } from '../../sessions/threads.service'
import type { FactoryDrivesService } from '../drives/drives.service'
import { EFactoryEventKind, EFactoryWorkItemStatus } from '../factory.types'
import type { FactoryCredentialService } from '../orchestrator/factory-credentials'
import { FactoryIdentityService } from '../orchestrator/factory-identity'
import type { OrchestratorChannel } from '../orchestrator/orchestrator-channel'
import { TranscriptService } from '../transcript.service'
import { WorkItemsService } from '../work-items.service'
import { EStationRunStatus } from './station.types'
import { StationsService } from './stations.service'

const INTAKE = {
  repo: 'dennisofficial/factory-scratch',
  sourceKind: 'github',
  surface: 'github',
  externalId: 'dennisofficial/factory-scratch#12',
  aliasKind: 'issue',
}

const LIVE_ENDPOINT = { token: 'tok_station', url: 'https://factory-st-x-3000.vercel.run' }

type Endpoint = { token: string; url: string } | null

export const stubFactorySandboxes = () => ({
  runningEndpoint: vi.fn(async (): Promise<Endpoint> => LIVE_ENDPOINT),
  attach: vi.fn(async () => ({ token: 'tok_fresh' })),
  whenSettled: vi.fn(async () => undefined),
  status: vi.fn(async () => ({ name: 'factory-st-x', url: LIVE_ENDPOINT.url })),
  stop: vi.fn(async () => undefined),
})

export const stubFactoryChannel = (
  fake: ReturnType<typeof fakeFactoryDb>,
): { inject: ReturnType<typeof vi.fn> } => ({
  inject: vi.fn(
    async (args: { threadId: string; text: string; accepted: () => Promise<boolean> }) => {
      fake.events.push({
        id: `evt_${fake.events.length + 1}`,
        threadId: args.threadId,
        seq: fake.events.length + 1,
        type: 'user-said',
        body: JSON.stringify({ type: 'user-said', text: args.text }),
      })
      if (!(await args.accepted())) throw new Error('the fake commit was not accepted')
    },
  ),
})

describe('StationsService', () => {
  const fake = fakeFactoryDb()
  let workItems: WorkItemsService
  let transcript: TranscriptService
  let threads: { create: ReturnType<typeof vi.fn> }
  let sandboxes: ReturnType<typeof stubFactorySandboxes>
  let channel: { inject: ReturnType<typeof vi.fn> }
  let credentials: { ensureSeeded: ReturnType<typeof vi.fn>; modelRef: ReturnType<typeof vi.fn> }
  let drives: { ensure: ReturnType<typeof vi.fn> }
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
    transcript = new TranscriptService()
    threads = {
      create: vi.fn(async () => ({ id: `brn_station_${fake.threads.length + 1}` })),
    }
    sandboxes = stubFactorySandboxes()
    channel = stubFactoryChannel(fake)
    credentials = {
      ensureSeeded: vi.fn(async () => undefined),
      modelRef: vi.fn(() => 'inference/kimi-k3-fast'),
    }
    drives = { ensure: vi.fn(async () => 'factory-dennisofficial-factory-scratch-12') }
    service = new StationsService(
      workItems,
      transcript,
      threads as unknown as ThreadsService,
      sandboxes as unknown as SandboxesService,
      new FactoryIdentityService(),
      credentials as unknown as FactoryCredentialService,
      drives as unknown as FactoryDrivesService,
      channel as OrchestratorChannel,
    )
  })

  describe('spawn', () => {
    it('refuses a caller that orchestrates no work item', async () => {
      await workItems.intake(INTAKE)
      await expect(spawn()).rejects.toThrow('not the orchestrator')
    })

    it('refuses an unknown station kind', async () => {
      await spawnOrchestrated()
      await expect(
        service.spawn({ orchestratorThreadId: 'brn_orchestrator_1', kind: 'wizard', message: 'x' }),
      ).rejects.toThrow('unknown station kind')
    })

    it('refuses to run a station on a merged work item', async () => {
      const item = await spawnOrchestrated()
      await workItems.transition({ workItemId: item.id, status: EFactoryWorkItemStatus.Merged })
      await expect(spawn()).rejects.toThrow('merged')
    })

    it('refuses a second writer while a station holds the drive', async () => {
      await spawnOrchestrated()
      await spawn('first')
      await flushSpawn()
      await expect(spawn('second')).rejects.toThrow('still holds')
    })

    it('provisions a drive-backed sandbox with the model default and records the request', async () => {
      const item = await spawnOrchestrated()
      const spawned = await spawn()
      await flushSpawn()

      expect(spawned.stationRunId).toMatch(/^fsr_/)
      const run = fake.stationRuns[0]
      expect(run?.workItemId).toBe(item.id)
      expect(run?.status).toBe(EStationRunStatus.Running)
      expect(run?.driveMode).toBe(ESandboxDriveMode.ReadWrite)

      const attachCalls = sandboxes.attach.mock.calls as unknown as Array<
        [
          {
            name: string
            workspace: { remoteUrl: string | null }
            drive: { name: string; mode: ESandboxDriveMode }
            pinnedModel: string
          },
        ]
      >
      const attachArgs = attachCalls[0]?.[0]
      if (attachArgs === undefined) throw new Error('expected an attach call')
      expect(attachArgs.name).toBe(`factory-st-${spawned.stationRunId.replaceAll('_', '-')}`)
      expect(attachArgs.workspace.remoteUrl).toBe('https://github.com/dennisofficial/factory-scratch.git')
      expect(attachArgs.drive).toEqual({
        name: 'factory-dennisofficial-factory-scratch-12',
        mode: ESandboxDriveMode.ReadWrite,
      })
      expect(attachArgs.pinnedModel).toBe('inference/kimi-k3-fast')

      const requestEvent = fake.transcriptEvents.find(
        (one) => one.kind === EFactoryEventKind.StationRequest,
      )
      expect(requestEvent?.deliveryId).toBe(`station-request:${spawned.stationRunId}`)

      const text = (channel.inject.mock.calls[0]?.[0] as { text: string }).text
      expect(text).toContain(spawned.stationRunId)
      expect(text).toContain('implement the thing')
      expect(text).toContain('implementer station')

      const updated = await workItems.find({ workItemId: item.id })
      expect(updated.status).toBe(EFactoryWorkItemStatus.Active)
    })

    it('a spawn whose message cannot be delivered stops the sandbox before failing the run', async () => {
      await spawnOrchestrated()
      sandboxes.runningEndpoint.mockResolvedValue(null)
      await spawn()
      await vi.waitFor(() => {
        expect(fake.stationRuns[0]?.status).toBe(EStationRunStatus.Failed)
      })
      expect(channel.inject).not.toHaveBeenCalled()
      expect(sandboxes.stop).toHaveBeenCalledWith({
        userId: fake.users[0]?.id,
        threadId: fake.stationRuns[0]?.threadId,
      })
    })
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
