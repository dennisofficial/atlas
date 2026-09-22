import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeFactoryDb } = await import('../../../../test/fake-factory-db.js')
  return { db: fakeFactoryDb().db as unknown as PrismaClient }
})

import { fakeFactoryDb } from '../../../../test/fake-factory-db.js'
import type { SandboxesService } from '../../sandboxes/sandboxes.service'
import { EFactoryEventKind, EFactoryWorkItemStatus } from '../factory.types'
import { FactoryIdentityService } from '../orchestrator/factory-identity'
import type { OrchestratorService } from '../orchestrator/orchestrator.service'
import type { GithubAppService } from '../reply/github-app.service'
import { TranscriptService } from '../transcript.service'
import { WorkItemsService } from '../work-items.service'
import { StationResultsService } from './station-results.service'
import { EStationKind, EStationRunStatus } from './station.types'

const INTAKE = {
  repo: 'dennisofficial/factory-scratch',
  sourceKind: 'github',
  surface: 'github',
  externalId: 'dennisofficial/factory-scratch#12',
  aliasKind: 'issue',
}

const SHA = 'b'.repeat(40)

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

describe('StationResultsService', () => {
  const fake = fakeFactoryDb()
  let workItems: WorkItemsService
  let sandboxes: { stop: ReturnType<typeof vi.fn> }
  let githubApp: {
    installationToken: ReturnType<typeof vi.fn>
    branchHead: ReturnType<typeof vi.fn>
  }
  let orchestrator: { wake: ReturnType<typeof vi.fn> }
  let service: StationResultsService
  let runId: string
  let stationThreadId: string

  const submit = (threadId: string, result: unknown) =>
    service.submitResult({ stationThreadId: threadId, runId, result })

  beforeEach(async () => {
    fake.reset()
    workItems = new WorkItemsService()
    sandboxes = { stop: vi.fn(async () => undefined) }
    githubApp = {
      installationToken: vi.fn(async () => 'ghs_installation'),
      branchHead: vi.fn(async () => SHA),
    }
    orchestrator = { wake: vi.fn() }
    service = new StationResultsService(
      workItems,
      new TranscriptService(),
      sandboxes as unknown as SandboxesService,
      new FactoryIdentityService(),
      githubApp as unknown as GithubAppService,
      orchestrator as unknown as OrchestratorService,
    )

    const { workItem } = await workItems.intake(INTAKE)
    await workItems.transition({ workItemId: workItem.id, status: EFactoryWorkItemStatus.Active })
    runId = 'fsr_run_1'
    stationThreadId = 'brn_station_1'
    const at = new Date().toISOString()
    fake.stationRuns.push({
      id: runId,
      workItemId: workItem.id,
      kind: EStationKind.Implementer,
      threadId: stationThreadId,
      status: EStationRunStatus.Running,
      driveMode: 'read-write',
      createdAt: at,
      updatedAt: at,
      finishedAt: null,
    })
  })

  it('refuses a result for an unknown run', async () => {
    runId = 'fsr_nope'
    await expect(submit(stationThreadId, resultPayload())).rejects.toThrow('unknown station run')
  })

  it('refuses a result from anyone but the run’s own sandbox', async () => {
    await expect(submit('brn_impostor', resultPayload())).rejects.toThrow('is not station run')
  })

  it('refuses an off-contract result and keeps the run open', async () => {
    await expect(submit(stationThreadId, { branch: 'x' })).rejects.toThrow('result.')
    expect(fake.stationRuns[0]?.status).toBe(EStationRunStatus.Running)
  })

  it('refuses a result whose branch is not a factory branch', async () => {
    await expect(
      submit(stationThreadId, { ...resultPayload(), branch: 'main' }),
    ).rejects.toThrow('not a factory branch')
  })

  it('refuses a result whose branch is not on the remote at the reported SHA', async () => {
    githubApp.branchHead.mockResolvedValueOnce(null)
    await expect(submit(stationThreadId, resultPayload())).rejects.toThrow('not on the remote')

    githubApp.branchHead.mockResolvedValueOnce('c'.repeat(40))
    await expect(submit(stationThreadId, resultPayload())).rejects.toThrow('not the reported')
    expect(fake.stationRuns[0]?.status).toBe(EStationRunStatus.Running)
  })

  it('records the result, finishes the run, stops the sandbox, and wakes the orchestrator', async () => {
    const accepted = await submit(stationThreadId, resultPayload())

    expect(accepted).toEqual({ recorded: true, stationRunId: runId })
    const event = fake.transcriptEvents.find((one) => one.kind === EFactoryEventKind.StationResult)
    expect(event?.deliveryId).toBe(`station-result:${runId}`)
    expect(event?.surface).toBe('github')
    expect(event?.payload).toContain('atlas-factory/add-the-thing')

    const finished = fake.stationRuns[0]
    expect(finished?.status).toBe(EStationRunStatus.Finished)
    expect(finished?.finishedAt).not.toBeNull()
    expect(sandboxes.stop).toHaveBeenCalledWith({
      userId: fake.users[0]?.id,
      threadId: stationThreadId,
    })
    expect(orchestrator.wake).toHaveBeenCalledWith({
      workItemId: fake.workItems[0]?.id,
      externalId: INTAKE.externalId,
    })
  })

  it('a replayed submission is recorded once and answers from the alias surface', async () => {
    await submit(stationThreadId, resultPayload())
    const replay = await submit(stationThreadId, resultPayload())

    expect(replay.recorded).toBe(true)
    expect(
      fake.transcriptEvents.filter((one) => one.kind === EFactoryEventKind.StationResult),
    ).toHaveLength(1)
  })

  it('records an unpushed result without calling github', async () => {
    const blocked = { ...resultPayload(), branch: '', pushed: false, head_sha: '' }
    await expect(submit(stationThreadId, blocked)).resolves.toEqual({
      recorded: true,
      stationRunId: runId,
    })
    expect(githubApp.branchHead).not.toHaveBeenCalled()
  })

  describe('reviewer runs', () => {
    const verdictPayload = (verdict: string) => ({
      verdict,
      head_sha: SHA,
      summary: 'reviewed the branch',
      criteria: [{ criterion: 'does the thing', pass: verdict === 'approve', note: 'checked' }],
      findings:
        verdict === 'approve'
          ? []
          : [{ severity: 'blocker', path: 'src/thing.ts', summary: 'wrong shape' }],
    })

    beforeEach(() => {
      const run = fake.stationRuns[0]
      if (run === undefined) throw new Error('missing run')
      run.kind = 'reviewer'
    })

    it('validates the verdict contract, not the implementer contract', async () => {
      await expect(submit(stationThreadId, resultPayload())).rejects.toThrow('verdict')
      expect(fake.stationRuns[0]?.status).toBe(EStationRunStatus.Running)
      expect(githubApp.branchHead).not.toHaveBeenCalled()
    })

    it('an approve verdict records and finishes the run', async () => {
      await expect(submit(stationThreadId, verdictPayload('approve'))).resolves.toEqual({
        recorded: true,
        stationRunId: runId,
      })
      const event = fake.transcriptEvents.find(
        (one) => one.kind === EFactoryEventKind.StationResult,
      )
      expect(event?.payload).toContain('"approve"')
      expect(fake.workItems[0]?.revisionCycles).toBe(0)
      expect(orchestrator.wake).toHaveBeenCalled()
    })

    it('a request_changes verdict counts a revision cycle', async () => {
      await submit(stationThreadId, verdictPayload('request_changes'))
      expect(fake.workItems[0]?.revisionCycles).toBe(1)
      const event = fake.transcriptEvents.find(
        (one) => one.kind === EFactoryEventKind.StationResult,
      )
      expect(event?.payload).toContain('request_changes')
    })

    it('a replayed request_changes does not burn a second cycle', async () => {
      await submit(stationThreadId, verdictPayload('request_changes'))
      await submit(stationThreadId, verdictPayload('request_changes'))
      expect(fake.workItems[0]?.revisionCycles).toBe(1)
    })
  })
})
