import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeFactoryDb } = await import('../../../../test/fake-factory-db.js')
  return { db: fakeFactoryDb().db as unknown as PrismaClient }
})

import { fakeFactoryDb } from '../../../../test/fake-factory-db.js'
import type { SandboxesService } from '../../platform/sandboxes/sandboxes.service'
import { ESandboxDriveMode } from '../../platform/sandboxes/sandboxes.types'
import type { ThreadsService } from '../../platform/sessions/threads.service'
import type { FactoryDrivesService } from '../drives/drives.service'
import {
  DEFAULT_ORGANIZATION_ID,
  EFactoryEventKind,
  EFactoryWorkItemStatus,
} from '../factory.types'
import type { FactoryCredentialService } from '../orchestrator/factory-credentials'
import { FactoryIdentityService } from '../orchestrator/factory-identity'
import type { OrchestratorChannel } from '../orchestrator/orchestrator-channel'
import { TranscriptService } from '../transcript.service'
import { WorkItemsService } from '../work-items.service'
import { EStationRunStatus } from './station.types'
import { StationsService } from './stations.service'

const INTAKE = {
  organizationId: DEFAULT_ORGANIZATION_ID,
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
      create: vi.fn(async () => {
        const id = `brn_station_${fake.threads.length + 1}`
        fake.threads.push({ id, head: 0 })
        return { id }
      }),
    }
    sandboxes = stubFactorySandboxes()
    channel = stubFactoryChannel(fake)
    credentials = {
      ensureSeeded: vi.fn(async () => undefined),
      modelRef: vi.fn(async () => 'inference/kimi-k3-fast'),
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

    it('spawns a reviewer on a drive snapshot, allowed while the writer runs', async () => {
      await spawnOrchestrated()
      await spawn('first implementer')
      await flushSpawn()

      const reviewed = await service.spawn({
        orchestratorThreadId: 'brn_orchestrator_1',
        kind: 'reviewer',
        message: 'review branch atlas-factory/add-the-thing',
      })
      await vi.waitFor(() => expect(channel.inject).toHaveBeenCalledTimes(2))

      const run = fake.stationRuns.find((one) => one.id === reviewed.stationRunId)
      expect(run?.driveMode).toBe(ESandboxDriveMode.Snapshot)
      expect(run?.kind).toBe('reviewer')
      const attachCalls = sandboxes.attach.mock.calls as unknown as Array<
        [{ drive: { mode: ESandboxDriveMode } }]
      >
      expect(attachCalls[1]?.[0].drive.mode).toBe(ESandboxDriveMode.Snapshot)
    })

    it('refuses the implementer past the revision cap', async () => {
      const item = await spawnOrchestrated()
      fake.workItems[0]!.revisionCycles = 3
      await expect(spawn()).rejects.toThrow('revision cycles')
      const fresh = await workItems.find({ workItemId: item.id })
      expect(fresh.revisionCycles).toBe(3)
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

})
