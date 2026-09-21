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
import { FactoryDrivesService } from '../drives/drives.service'
import { EFactoryEventKind, EFactoryWorkItemStatus } from '../factory.types'
import type { FactoryCredentialService } from '../orchestrator/factory-credentials'
import { FactoryIdentityService } from '../orchestrator/factory-identity'
import type { OrchestratorChannel } from '../orchestrator/orchestrator-channel'
import type { OrchestratorService } from '../orchestrator/orchestrator.service'
import type { GithubAppService } from '../reply/github-app.service'
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

const SHA = 'b'.repeat(40)
const LIVE_ENDPOINT = { token: 'tok_station', url: 'https://factory-st-x-3000.vercel.run' }

const resultPayload = () => ({
  branch: 'atlas-factory/add-the-thing',
  base: 'main',
  pushed: true,
  head_sha: SHA,
  change_summary: [{ path: 'src/thing.ts', change: 'added it' }],
  verification: [{ command: 'bun test', result: '12 pass' }],
  deviations: [],
  known_limitations: [],
})

describe('StationsService', () => {
  const fake = fakeFactoryDb()
  let workItems: WorkItemsService
  let transcript: TranscriptService
  let threads: { create: ReturnType<typeof vi.fn> }
  let sandboxes: {
    runningEndpoint: ReturnType<typeof vi.fn>
    attach: ReturnType<typeof vi.fn>
    whenSettled: ReturnType<typeof vi.fn>
    status: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
  }
  let channel: { inject: ReturnType<typeof vi.fn> }
  let credentials: { ensureSeeded: ReturnType<typeof vi.fn>; modelRef: ReturnType<typeof vi.fn> }
  let drives: { ensure: ReturnType<typeof vi.fn> }
  let githubApp: {
    installationToken: ReturnType<typeof vi.fn>
    branchHead: ReturnType<typeof vi.fn>
  }
  let orchestrator: { wake: ReturnType<typeof vi.fn> }
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
    sandboxes = {
      runningEndpoint: vi.fn(async () => LIVE_ENDPOINT),
      attach: vi.fn(async () => ({ token: 'tok_fresh' })),
      whenSettled: vi.fn(async () => undefined),
      status: vi.fn(async () => ({ name: 'factory-st-x', url: LIVE_ENDPOINT.url })),
      stop: vi.fn(async () => undefined),
    }
    channel = {
      inject: vi.fn(async (args: { threadId: string; text: string; accepted: () => Promise<boolean> }) => {
        fake.events.push({
          id: `evt_${fake.events.length + 1}`,
          threadId: args.threadId,
          seq: fake.events.length + 1,
          type: 'user-said',
          body: JSON.stringify({ type: 'user-said', text: args.text }),
        })
        if (!(await args.accepted())) throw new Error('the fake commit was not accepted')
      }),
    }
    credentials = {
      ensureSeeded: vi.fn(async () => undefined),
      modelRef: vi.fn(() => 'inference/kimi-k3-fast'),
    }
    drives = { ensure: vi.fn(async () => 'factory-dennisofficial-factory-scratch-12') }
    githubApp = {
      installationToken: vi.fn(async () => 'ghs_installation'),
      branchHead: vi.fn(async () => SHA),
    }
    orchestrator = { wake: vi.fn() }
    service = new StationsService(
      workItems,
      transcript,
      threads as unknown as ThreadsService,
      sandboxes as unknown as SandboxesService,
      new FactoryIdentityService(),
      credentials as unknown as FactoryCredentialService,
      drives as unknown as FactoryDrivesService,
      githubApp as unknown as GithubAppService,
      orchestrator as unknown as OrchestratorService,
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

    it('provisions a drive-backed sandbox with the model pin and records the request', async () => {
      const item = await spawnOrchestrated()
      const spawned = await spawn()
      await flushSpawn()

      expect(spawned.stationRunId).toMatch(/^fsr_/)
      const run = fake.stationRuns[0]
      expect(run?.workItemId).toBe(item.id)
      expect(run?.status).toBe(EStationRunStatus.Running)
      expect(run?.driveMode).toBe(ESandboxDriveMode.ReadWrite)

      const attachArgs = sandboxes.attach.mock.calls[0]?.[0] as {
        name: string
        workspace: { remoteUrl: string | null }
        drive: { name: string; mode: ESandboxDriveMode }
        pinnedModel: string
      }
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
      expect(orchestrator.wake).not.toHaveBeenCalled()

      const text = (channel.inject.mock.calls[0]?.[0] as { text: string }).text
      expect(text).toContain(spawned.stationRunId)
      expect(text).toContain('implement the thing')
      expect(text).toContain('implementer station')

      const updated = await workItems.find({ workItemId: item.id })
      expect(updated.status).toBe(EFactoryWorkItemStatus.Active)
    })

    it('marks the run failed when the spawn message cannot be delivered', async () => {
      await spawnOrchestrated()
      sandboxes.runningEndpoint.mockResolvedValue(null)
      const spawned = await spawn()
      await vi.waitFor(() => {
        expect(fake.stationRuns[0]?.status).toBe(EStationRunStatus.Failed)
      })
      expect(channel.inject).not.toHaveBeenCalled()
    })
  })

  describe('submitResult', () => {
    const spawnAndGetRun = async () => {
      await spawnOrchestrated()
      const spawned = await spawn()
      await flushSpawn()
      const run = fake.stationRuns[0]
      if (run === undefined) throw new Error('missing run')
      return { spawned, run }
    }

    const submit = (threadId: string, runId: string, result: unknown) =>
      service.submitResult({ stationThreadId: threadId, runId, result })

    it('refuses a result from anyone but the run’s own sandbox', async () => {
      const { spawned } = await spawnAndGetRun()
      await expect(submit('brn_impostor', spawned.stationRunId, resultPayload())).rejects.toThrow(
        'is not station run',
      )
    })

    it('refuses an off-contract result and keeps the run open', async () => {
      const { spawned, run } = await spawnAndGetRun()
      await expect(submit(run.threadId, spawned.stationRunId, { branch: 'x' })).rejects.toThrow(
        'result.',
      )
      expect(fake.stationRuns[0]?.status).toBe(EStationRunStatus.Running)
    })

    it('refuses a result whose branch is not a factory branch', async () => {
      const { spawned, run } = await spawnAndGetRun()
      await expect(
        submit(run.threadId, spawned.stationRunId, { ...resultPayload(), branch: 'main' }),
      ).rejects.toThrow('not a factory branch')
    })

    it('refuses a result whose branch is not on the remote at the reported SHA', async () => {
      const { spawned, run } = await spawnAndGetRun()
      githubApp.branchHead.mockResolvedValueOnce(null)
      await expect(submit(run.threadId, spawned.stationRunId, resultPayload())).rejects.toThrow(
        'not on the remote',
      )

      githubApp.branchHead.mockResolvedValueOnce('c'.repeat(40))
      await expect(submit(run.threadId, spawned.stationRunId, resultPayload())).rejects.toThrow(
        'not the reported',
      )
      expect(fake.stationRuns[0]?.status).toBe(EStationRunStatus.Running)
    })

    it('records the result, finishes the run, stops the sandbox, and wakes the orchestrator', async () => {
      const { spawned, run } = await spawnAndGetRun()
      const accepted = await submit(run.threadId, spawned.stationRunId, resultPayload())

      expect(accepted).toEqual({ recorded: true, stationRunId: spawned.stationRunId })
      const event = fake.transcriptEvents.find(
        (one) => one.kind === EFactoryEventKind.StationResult,
      )
      expect(event?.deliveryId).toBe(`station-result:${spawned.stationRunId}`)
      expect(event?.payload).toContain('atlas-factory/add-the-thing')

      const finished = fake.stationRuns[0]
      expect(finished?.status).toBe(EStationRunStatus.Finished)
      expect(finished?.finishedAt).not.toBeNull()
      expect(sandboxes.stop).toHaveBeenCalledWith({ userId: fake.users[0]?.id, threadId: run.threadId })
      expect(orchestrator.wake).toHaveBeenCalledWith({
        workItemId: run.workItemId,
        externalId: INTAKE.externalId,
      })
    })

    it('a replayed submission is recorded once', async () => {
      const { spawned, run } = await spawnAndGetRun()
      await submit(run.threadId, spawned.stationRunId, resultPayload())
      const replay = await submit(run.threadId, spawned.stationRunId, resultPayload())

      expect(replay.recorded).toBe(true)
      expect(
        fake.transcriptEvents.filter((one) => one.kind === EFactoryEventKind.StationResult),
      ).toHaveLength(1)
    })

    it('records an unpushed result without calling github', async () => {
      const { spawned, run } = await spawnAndGetRun()
      const blocked = { ...resultPayload(), branch: '', pushed: false, head_sha: '' }
      await expect(submit(run.threadId, spawned.stationRunId, blocked)).resolves.toEqual({
        recorded: true,
        stationRunId: spawned.stationRunId,
      })
      expect(githubApp.branchHead).not.toHaveBeenCalled()
    })
  })

  describe('mintGitToken', () => {
    const spawnAndGetRun = async () => {
      await spawnOrchestrated()
      const spawned = await spawn()
      await flushSpawn()
      const run = fake.stationRuns[0]
      if (run === undefined) throw new Error('missing run')
      return { spawned, run }
    }

    it('refuses a caller that is not a running station', async () => {
      await spawnOrchestrated()
      await expect(
        service.mintGitToken({ stationThreadId: 'brn_orchestrator_1', branch: 'atlas-factory/x' }),
      ).rejects.toThrow('not a running factory station')
    })

    it('refuses main and master by name', async () => {
      const { run } = await spawnAndGetRun()
      await expect(
        service.mintGitToken({ stationThreadId: run.threadId, branch: 'main' }),
      ).rejects.toThrow('refused')
      await expect(
        service.mintGitToken({ stationThreadId: run.threadId, branch: 'master' }),
      ).rejects.toThrow('refused')
      expect(githubApp.installationToken).not.toHaveBeenCalled()
    })

    it('refuses branches outside the factory prefix', async () => {
      const { run } = await spawnAndGetRun()
      await expect(
        service.mintGitToken({ stationThreadId: run.threadId, branch: 'dennis/feature' }),
      ).rejects.toThrow('atlas-factory/')
    })

    it('mints an installation token for the work item repo', async () => {
      const { run } = await spawnAndGetRun()
      const minted = await service.mintGitToken({
        stationThreadId: run.threadId,
        branch: 'atlas-factory/add-the-thing',
      })
      expect(minted.token).toBe('ghs_installation')
      expect(githubApp.installationToken).toHaveBeenCalledWith({
        owner: 'dennisofficial',
        repo: 'factory-scratch',
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
      const event = fake.events.find((one) => one.threadId === run.threadId && one.body.includes('steer:'))
      expect(event).toBeDefined()
    })

    it('refuses to steer a finished run', async () => {
      const { spawned, run } = await spawnAndGetRun()
      await service.submitResult({
        stationThreadId: run.threadId,
        runId: spawned.stationRunId,
        result: resultPayload(),
      })
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
      expect(sandboxes.stop).toHaveBeenCalledWith({ userId: fake.users[0]?.id, threadId: run.threadId })
      expect(fake.stationRuns[0]?.status).toBe(EStationRunStatus.Stopped)
    })

    it('refuses steer and stop from a non-orchestrator caller', async () => {
      const { spawned } = await spawnAndGetRun()
      await expect(
        service.steer({ orchestratorThreadId: 'brn_other', runId: spawned.stationRunId, message: 'x' }),
      ).rejects.toThrow('not the orchestrator')
      await expect(
        service.stop({ orchestratorThreadId: 'brn_other', runId: spawned.stationRunId }),
      ).rejects.toThrow('not the orchestrator')
    })
  })
})
