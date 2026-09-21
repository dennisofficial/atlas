import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeFactoryDb } = await import('../../../../test/fake-factory-db.js')
  return { db: fakeFactoryDb().db as unknown as PrismaClient }
})

import { fakeFactoryDb } from '../../../../test/fake-factory-db.js'
import {
  EFactoryAliasKind,
  EFactoryEventKind,
  EFactoryWorkItemStatus,
} from '../factory.types'
import type { GithubAppService } from '../reply/github-app.service'
import { TranscriptService } from '../transcript.service'
import { WorkItemsService } from '../work-items.service'
import { DeliveriesService } from './deliveries.service'

const INTAKE = {
  repo: 'dennisofficial/factory-scratch',
  sourceKind: 'github',
  surface: 'github',
  externalId: 'dennisofficial/factory-scratch#12',
  aliasKind: 'issue',
}

const SHA = 'a'.repeat(40)

const implementerResult = () => ({
  branch: 'atlas-factory/add-the-thing',
  base: 'main',
  pushed: true,
  head_sha: SHA,
  change_summary: [{ path: 'src/thing.ts', change: 'added it' }],
  verification: [{ command: 'bun test', result: '12 pass' }],
  deviations: [],
  known_limitations: [],
})

const reviewerVerdict = (verdict: string) => ({
  verdict,
  head_sha: SHA,
  summary: 'reviewed',
  criteria: [{ criterion: 'works', pass: verdict === 'approve', note: 'checked' }],
  findings:
    verdict === 'approve'
      ? []
      : [{ severity: 'should-fix', path: 'src/thing.ts', summary: 'needs work' }],
})

describe('DeliveriesService', () => {
  const fake = fakeFactoryDb()
  let workItems: WorkItemsService
  let transcript: TranscriptService
  let githubApp: {
    branchHead: ReturnType<typeof vi.fn>
    createPullRequest: ReturnType<typeof vi.fn>
  }
  let service: DeliveriesService
  let resultSeq: number

  const deliver = (threadId = 'brn_orchestrator_1') =>
    service.deliver({ orchestratorThreadId: threadId, title: 'Add the thing', body: 'Does it.' })

  const appendResult = async (kind: string, result: unknown) => {
    resultSeq += 1
    const appended = await transcript.append({
      surface: 'github',
      externalId: INTAKE.externalId,
      deliveryId: `station-result:fsr_${resultSeq}`,
      kind: EFactoryEventKind.StationResult,
      author: 'atlas-factory',
      payload: JSON.stringify({ runId: `fsr_${resultSeq}`, kind, result }),
    })
    if (appended === null) throw new Error('fixture append failed')
  }

  const readyWorkItem = async () => {
    const { workItem } = await workItems.intake(INTAKE)
    fake.workItems[0]!.orchestratorThreadId = 'brn_orchestrator_1'
    await workItems.transition({ workItemId: workItem.id, status: EFactoryWorkItemStatus.Active })
    return workItem
  }

  const deliverableWorkItem = async () => {
    const workItem = await readyWorkItem()
    await appendResult('implementer', implementerResult())
    await appendResult('reviewer', reviewerVerdict('approve'))
    return workItem
  }

  beforeEach(() => {
    fake.reset()
    resultSeq = 0
    workItems = new WorkItemsService()
    transcript = new TranscriptService()
    githubApp = {
      branchHead: vi.fn(async () => SHA),
      createPullRequest: vi.fn(async () => ({
        number: 41,
        url: 'https://github.com/dennisofficial/factory-scratch/pull/41',
      })),
    }
    service = new DeliveriesService(workItems, transcript, githubApp as unknown as GithubAppService)
  })

  it('opens the draft PR, registers its alias, records the delivery, and transitions', async () => {
    const workItem = await deliverableWorkItem()
    const delivered = await deliver()

    expect(delivered).toEqual({
      delivered: true,
      number: 41,
      url: 'https://github.com/dennisofficial/factory-scratch/pull/41',
      branch: 'atlas-factory/add-the-thing',
    })
    expect(githubApp.createPullRequest).toHaveBeenCalledWith({
      owner: 'dennisofficial',
      repo: 'factory-scratch',
      head: 'atlas-factory/add-the-thing',
      base: 'main',
      title: 'Add the thing',
      body: 'Does it.',
    })

    const aliases = await workItems.listAliases({ workItemId: workItem.id })
    const prAlias = aliases.find((one) => one.kind === EFactoryAliasKind.PullRequest)
    expect(prAlias?.externalId).toBe('dennisofficial/factory-scratch/pull/41')

    const event = fake.transcriptEvents.find((one) => one.kind === EFactoryEventKind.Delivery)
    expect(event?.payload).toContain('dennisofficial/factory-scratch/pull/41')
    expect(event?.deliveryId).toBe(`delivery:${workItem.id}`)

    expect((await workItems.find({ workItemId: workItem.id })).status).toBe(
      EFactoryWorkItemStatus.Delivered,
    )
  })

  it('refuses a caller that orchestrates no work item', async () => {
    await deliverableWorkItem()
    await expect(deliver('brn_impostor')).rejects.toThrow('not the orchestrator')
  })

  it('refuses a work item that already delivered', async () => {
    await deliverableWorkItem()
    await deliver()
    await expect(deliver()).rejects.toThrow('does not deliver')
  })

  it('refuses when a pull request alias already exists', async () => {
    const workItem = await deliverableWorkItem()
    await workItems.registerAlias({
      workItemId: workItem.id,
      surface: 'github',
      externalId: 'dennisofficial/factory-scratch/pull/40',
      kind: EFactoryAliasKind.PullRequest,
    })
    await expect(deliver()).rejects.toThrow('already has a pull request')
  })

  it('refuses without an implementer result', async () => {
    await readyWorkItem()
    await expect(deliver()).rejects.toThrow('no implementer result')
  })

  it('refuses an unpushed, non-factory-branch, or unverified result', async () => {
    await readyWorkItem()
    await appendResult('implementer', { ...implementerResult(), pushed: false, head_sha: '' })
    await expect(deliver()).rejects.toThrow('pushed nothing')

    fake.transcriptEvents.length = 0
    await appendResult('implementer', { ...implementerResult(), branch: 'main' })
    await expect(deliver()).rejects.toThrow('not factory-owned')

    fake.transcriptEvents.length = 0
    await appendResult('implementer', { ...implementerResult(), verification: [] })
    await expect(deliver()).rejects.toThrow('no verification evidence')
  })

  it('refuses when the remote head moved past the reported SHA', async () => {
    await readyWorkItem()
    await appendResult('implementer', implementerResult())
    githubApp.branchHead.mockResolvedValueOnce('c'.repeat(40))
    await expect(deliver()).rejects.toThrow('not the implementer')
  })

  it('refuses when the approving review covered a different head', async () => {
    await readyWorkItem()
    await appendResult('implementer', implementerResult())
    await appendResult('reviewer', { ...reviewerVerdict('approve'), head_sha: 'e'.repeat(40) })
    await expect(deliver()).rejects.toThrow('re-review the current head')
    expect(githubApp.createPullRequest).not.toHaveBeenCalled()
  })

  it('refuses past the revision cap even with an approving review', async () => {
    await deliverableWorkItem()
    fake.workItems[0]!.revisionCycles = 3
    await expect(deliver()).rejects.toThrow('revision cycles')
    expect(githubApp.createPullRequest).not.toHaveBeenCalled()
  })

  it('refuses without an approving review', async () => {
    await readyWorkItem()
    await appendResult('implementer', implementerResult())
    await expect(deliver()).rejects.toThrow('no reviewer verdict')

    await appendResult('reviewer', reviewerVerdict('request_changes'))
    await expect(deliver()).rejects.toThrow('requested changes')
    expect(githubApp.createPullRequest).not.toHaveBeenCalled()
  })

  it('the latest results win: a fresh approval after request_changes delivers', async () => {
    await deliverableWorkItem()
    await appendResult('reviewer', reviewerVerdict('request_changes'))
    await appendResult('implementer', implementerResult())
    await appendResult('reviewer', reviewerVerdict('approve'))
    await expect(deliver()).resolves.toMatchObject({ delivered: true, number: 41 })
  })
})
