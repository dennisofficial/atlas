import { BadRequestException, ForbiddenException, HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeFactoryDb } = await import('../../../../test/fake-factory-db.js')
  return { db: fakeFactoryDb().db as unknown as PrismaClient }
})

import { fakeFactoryDb } from '../../../../test/fake-factory-db.js'
import { DEFAULT_ORGANIZATION_ID, EFactoryEventKind } from '../factory.types'
import { TranscriptService } from '../transcript.service'
import { WorkItemsService } from '../work-items.service'
import type { GithubAppService } from './github-app.service'
import { GuardedReplyService } from './guarded-reply.service'

const INTAKE = {
  organizationId: DEFAULT_ORGANIZATION_ID,
  repo: 'compai/atlas',
  sourceKind: 'github',
  surface: 'github',
  externalId: 'compai/atlas#341',
  aliasKind: 'issue',
}

const POSTED_URL = 'https://github.com/compai/atlas/issues/341#issuecomment-1'

describe('GuardedReplyService', () => {
  const fake = fakeFactoryDb()
  let workItems: WorkItemsService
  let transcript: TranscriptService
  let githubApp: { createComment: ReturnType<typeof vi.fn> }
  let service: GuardedReplyService

  const orchestrate = async (): Promise<{ workItemId: string; threadId: string }> => {
    const { workItem } = await workItems.intake(INTAKE)
    await workItems.claimOrchestrator({ workItemId: workItem.id, threadId: 'brn_orchestrator' })
    return { workItemId: workItem.id, threadId: 'brn_orchestrator' }
  }

  const reply = (externalId: string) =>
    service.reply({
      orchestratorThreadId: 'brn_orchestrator',
      surface: 'github',
      externalId,
      body: 'triage: looking at this',
    })

  beforeEach(() => {
    fake.reset()
    workItems = new WorkItemsService()
    transcript = new TranscriptService()
    githubApp = { createComment: vi.fn(async () => ({ url: POSTED_URL })) }
    service = new GuardedReplyService(transcript, githubApp as unknown as GithubAppService)
  })

  it('posts to an aliased surface and records the reply on the transcript', async () => {
    const { workItemId } = await orchestrate()

    const result = await reply('compai/atlas#341')

    expect(result).toEqual({
      posted: true,
      surface: 'github',
      externalId: 'compai/atlas#341',
      url: POSTED_URL,
    })
    expect(githubApp.createComment).toHaveBeenCalledWith({
      owner: 'compai',
      repo: 'atlas',
      issueNumber: 341,
      body: 'triage: looking at this',
    })
    const events = await transcript.list({ workItemId })
    const recorded = events.filter((event) => event.kind === EFactoryEventKind.Reply)
    expect(recorded).toHaveLength(1)
    expect(JSON.parse(recorded[0]?.payload ?? '{}')).toEqual({
      body: 'triage: looking at this',
      url: POSTED_URL,
    })
  })

  it('posts to an aliased pull-request surface through the issues api', async () => {
    const { workItemId } = await orchestrate()
    await workItems.registerAlias({
      workItemId,
      surface: 'github',
      externalId: 'compai/atlas/pull/87',
      kind: 'pull-request',
    })

    const result = await reply('compai/atlas/pull/87')

    expect(result.posted).toBe(true)
    expect(githubApp.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ issueNumber: 87 }),
    )
  })

  it('refuses a surface that is aliased to a different work item', async () => {
    await orchestrate()
    await workItems.intake({ ...INTAKE, externalId: 'compai/atlas#999' })

    await expect(reply('compai/atlas#999')).rejects.toBeInstanceOf(ForbiddenException)
    expect(githubApp.createComment).not.toHaveBeenCalled()
  })

  it('refuses a surface nothing has ever aliased', async () => {
    await orchestrate()

    await expect(reply('compai/other#1')).rejects.toBeInstanceOf(ForbiddenException)
    expect(githubApp.createComment).not.toHaveBeenCalled()
  })

  it('refuses a sandbox that orchestrates no work item', async () => {
    await orchestrate()

    await expect(
      service.reply({
        orchestratorThreadId: 'brn_stranger',
        surface: 'github',
        externalId: 'compai/atlas#341',
        body: 'impersonation attempt',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(githubApp.createComment).not.toHaveBeenCalled()
  })

  it('refuses a surface id outside the factory grammars', async () => {
    await orchestrate()

    await expect(reply('https://github.com/compai/atlas/issues/341')).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(githubApp.createComment).not.toHaveBeenCalled()
  })

  it('refuses surfaces that are not github', async () => {
    const { workItemId } = await orchestrate()
    await workItems.registerAlias({
      workItemId,
      surface: 'linear',
      externalId: 'COMP-88',
      kind: 'ticket',
    })

    await expect(
      service.reply({
        orchestratorThreadId: 'brn_orchestrator',
        surface: 'linear',
        externalId: 'COMP-88',
        body: 'cross-surface leak',
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(githubApp.createComment).not.toHaveBeenCalled()
  })

  it('rate-limits replies per work item within the window', async () => {
    await orchestrate()
    const windowStart = Date.now() - 30 * 60 * 1000
    for (let index = 0; index < 10; index += 1) {
      await transcript.append({
        surface: 'github',
        externalId: 'compai/atlas#341',
        deliveryId: `reply:past-${index}`,
        kind: EFactoryEventKind.Reply,
        payload: '{}',
      })
      const row = fake.transcriptEvents.at(-1)
      if (row !== undefined) row.receivedAt = new Date(windowStart).toISOString()
    }

    const refusal = await reply('compai/atlas#341').catch((failure: unknown) => failure)
    expect(refusal).toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS })
    expect(githubApp.createComment).not.toHaveBeenCalled()
  })

  it('replies outside the window do not count against the limit', async () => {
    await orchestrate()
    await transcript.append({
      surface: 'github',
      externalId: 'compai/atlas#341',
      deliveryId: 'reply:ancient',
      kind: EFactoryEventKind.Reply,
      payload: '{}',
    })
    const row = fake.transcriptEvents.at(-1)
    if (row !== undefined) row.receivedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()

    const result = await reply('compai/atlas#341')
    expect(result.posted).toBe(true)
  })
})
