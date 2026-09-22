import { Logger } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../generated/prisma/client'

vi.mock('../../db', async () => {
  const { fakeFactoryDb } = await import('../../../test/fake-factory-db.js')
  return { db: fakeFactoryDb().db as unknown as PrismaClient }
})

import { fakeFactoryDb } from '../../../test/fake-factory-db.js'
import { FactoryConnectionsService } from './connections/connections.service'
import type { FactoryDrivesService } from './drives/drives.service'
import { EFactoryEventKind, EFactoryWorkItemStatus } from './factory.types'
import { LinearWebhookService } from './linear-webhook.service'
import type { OrchestratorService } from './orchestrator/orchestrator.service'
import type { StationsService } from './stations/stations.service'
import { TranscriptService } from './transcript.service'
import { WorkItemsService } from './work-items.service'

const WORKSPACE = 'dc844923-f9a4-40a3-825c-dea7747e57d6'
const ISSUE_ID = '2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9'

function seedConnection(): void {
  fakeFactoryDb().connections.push({
    id: 'fco_1',
    organizationId: 'org_compai',
    provider: 'linear',
    externalAccountId: WORKSPACE,
    sealedCredentials: null,
    scopes: null,
    status: 'active',
    createdAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z',
  })
}

function agentSessionCreatedPayload(args: { workspaceId?: string } = {}): unknown {
  return {
    action: 'created',
    type: 'AgentSessionEvent',
    organizationId: args.workspaceId ?? WORKSPACE,
    webhookId: 'wh-1',
    webhookTimestamp: 1676056940508,
    createdAt: '2026-09-22T00:00:00.000Z',
    appUserId: 'app-user-1',
    oauthClientId: 'oauth-client-1',
    agentSession: {
      id: 'session-1',
      status: 'pending',
      issue: { id: ISSUE_ID, identifier: 'ENG-123', title: 'Fix the thing', url: 'https://linear.app/issue/ENG-123' },
      creator: { id: 'user-1', name: 'Dennis Lysenko' },
    },
  }
}

function agentSessionPromptedPayload(): unknown {
  return {
    action: 'prompted',
    type: 'AgentSessionEvent',
    organizationId: WORKSPACE,
    webhookId: 'wh-1',
    webhookTimestamp: 1676056940508,
    createdAt: '2026-09-22T00:00:00.000Z',
    appUserId: 'app-user-1',
    oauthClientId: 'oauth-client-1',
    agentSession: {
      id: 'session-1',
      status: 'active',
      issue: { id: ISSUE_ID, identifier: 'ENG-123', title: 'Fix the thing', url: 'https://linear.app/issue/ENG-123' },
    },
    agentActivity: {
      id: 'activity-1',
      content: { type: 'prompt', body: 'please also add tests' },
      user: { id: 'user-1', name: 'Dennis Lysenko' },
    },
  }
}

function issueUpdatePayload(args: { stateType: string }): unknown {
  return {
    action: 'update',
    type: 'Issue',
    organizationId: WORKSPACE,
    webhookId: 'wh-1',
    webhookTimestamp: 1676056940508,
    createdAt: '2026-09-22T00:00:00.000Z',
    actor: { id: 'user-1', name: 'Dennis Lysenko' },
    url: 'https://linear.app/issue/ENG-123',
    data: {
      id: ISSUE_ID,
      identifier: 'ENG-123',
      title: 'Fix the thing',
      state: { id: 'state-1', name: 'Done', type: args.stateType },
    },
  }
}

function commentCreatedPayload(): unknown {
  return {
    action: 'create',
    type: 'Comment',
    organizationId: WORKSPACE,
    webhookId: 'wh-1',
    webhookTimestamp: 1676056940508,
    createdAt: '2026-09-22T00:00:00.000Z',
    actor: { id: 'user-1', name: 'Dennis Lysenko' },
    url: 'https://linear.app/issue/ENG-123#comment-1',
    data: { id: 'comment-1', body: 'looks good', issueId: ISSUE_ID, userId: 'user-1' },
  }
}

describe('LinearWebhookService', () => {
  const fake = fakeFactoryDb()
  let service: LinearWebhookService
  let workItems: WorkItemsService
  let orchestrator: { wake: ReturnType<typeof vi.fn> }
  let drives: { release: ReturnType<typeof vi.fn> }
  let stations: { stopRunningFor: ReturnType<typeof vi.fn> }
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fake.reset()
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    workItems = new WorkItemsService()
    orchestrator = { wake: vi.fn() }
    drives = { release: vi.fn(async () => true) }
    stations = { stopRunningFor: vi.fn(async () => undefined) }
    service = new LinearWebhookService(
      workItems,
      new FactoryConnectionsService(),
      new TranscriptService(),
      orchestrator as unknown as OrchestratorService,
      drives as unknown as FactoryDrivesService,
      stations as unknown as StationsService,
    )
  })

  it('drops a delivery for a workspace with no connection, logging the workspace id', async () => {
    const outcome = await service.handle({
      deliveryId: 'd-1',
      payload: agentSessionCreatedPayload({ workspaceId: 'unknown-workspace' }),
    })

    expect(outcome).toEqual({ handled: false })
    expect(fake.workItems).toHaveLength(0)
    expect(fake.transcriptEvents).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown-workspace'))
    expect(orchestrator.wake).not.toHaveBeenCalled()
  })

  it('an agent session created on an issue intakes into the connection organization', async () => {
    seedConnection()

    const outcome = await service.handle({
      deliveryId: 'd-1',
      payload: agentSessionCreatedPayload(),
    })

    expect(outcome.handled).toBe(true)
    expect(outcome.kind).toBe(EFactoryEventKind.Intake)
    expect(fake.workItems).toHaveLength(1)
    expect(fake.workItems[0]?.organizationId).toBe('org_compai')
    expect(fake.workItems[0]?.repo).toBe('ENG-123')
    expect(fake.workItems[0]?.sourceKind).toBe('linear')
    expect(fake.aliases).toMatchObject([{ surface: 'linear', externalId: ISSUE_ID, kind: 'issue' }])
    expect(fake.transcriptEvents).toMatchObject([
      { kind: EFactoryEventKind.Intake, author: 'Dennis Lysenko', deliveryId: 'd-1' },
    ])
    expect(orchestrator.wake).toHaveBeenCalledTimes(1)
  })

  it('a redelivered agent session created appends only once and wakes only once', async () => {
    seedConnection()

    await service.handle({ deliveryId: 'd-1', payload: agentSessionCreatedPayload() })
    const replay = await service.handle({ deliveryId: 'd-1', payload: agentSessionCreatedPayload() })

    expect(replay).toMatchObject({ handled: true, appended: false })
    expect(fake.workItems).toHaveLength(1)
    expect(fake.transcriptEvents.filter((one) => one.deliveryId === 'd-1')).toHaveLength(1)
    expect(orchestrator.wake).toHaveBeenCalledTimes(1)
  })

  it('a prompted agent session appends a comment event to the aliased issue', async () => {
    seedConnection()
    await service.handle({ deliveryId: 'd-1', payload: agentSessionCreatedPayload() })

    const outcome = await service.handle({
      deliveryId: 'd-2',
      payload: agentSessionPromptedPayload(),
    })

    expect(outcome).toMatchObject({ handled: true, kind: EFactoryEventKind.Comment, appended: true })
    expect(fake.transcriptEvents).toMatchObject([
      { kind: EFactoryEventKind.Intake },
      { kind: EFactoryEventKind.Comment, author: 'Dennis Lysenko' },
    ])
    expect(orchestrator.wake).toHaveBeenCalledTimes(2)
  })

  it('an agent session without an issue is dropped', async () => {
    seedConnection()
    const payload = agentSessionCreatedPayload() as {
      agentSession: { issue?: unknown }
    }
    delete payload.agentSession.issue

    const outcome = await service.handle({ deliveryId: 'd-1', payload })

    expect(outcome).toEqual({ handled: false })
    expect(fake.workItems).toHaveLength(0)
  })

  it('an issue moved to a completed state closes the work item and releases its drive', async () => {
    seedConnection()
    const { workItem } = await workItems.intake({
      organizationId: 'org_compai',
      repo: 'ENG-123',
      sourceKind: 'linear',
      surface: 'linear',
      externalId: ISSUE_ID,
      aliasKind: 'issue',
    })

    const outcome = await service.handle({
      deliveryId: 'd-done',
      payload: issueUpdatePayload({ stateType: 'completed' }),
    })

    expect(outcome).toMatchObject({ handled: true, workItemId: workItem.id, appended: true })
    expect((await workItems.find({ workItemId: workItem.id })).status).toBe(
      EFactoryWorkItemStatus.Closed,
    )
    expect(stations.stopRunningFor).toHaveBeenCalledWith({ workItemId: workItem.id })
    expect(drives.release).toHaveBeenCalledWith({ workItemId: workItem.id })
    expect(orchestrator.wake).toHaveBeenCalledTimes(1)
  })

  it('a redelivered completion does not re-transition the work item', async () => {
    seedConnection()
    await workItems.intake({
      organizationId: 'org_compai',
      repo: 'ENG-123',
      sourceKind: 'linear',
      surface: 'linear',
      externalId: ISSUE_ID,
      aliasKind: 'issue',
    })

    await service.handle({ deliveryId: 'd-done', payload: issueUpdatePayload({ stateType: 'canceled' }) })
    const replay = await service.handle({
      deliveryId: 'd-done',
      payload: issueUpdatePayload({ stateType: 'canceled' }),
    })

    expect(replay).toMatchObject({ handled: true, appended: false })
    expect(drives.release).toHaveBeenCalledTimes(1)
    expect(orchestrator.wake).toHaveBeenCalledTimes(1)
  })

  it('an ordinary issue update appends a status-change event without closing', async () => {
    seedConnection()
    const { workItem } = await workItems.intake({
      organizationId: 'org_compai',
      repo: 'ENG-123',
      sourceKind: 'linear',
      surface: 'linear',
      externalId: ISSUE_ID,
      aliasKind: 'issue',
    })

    const outcome = await service.handle({
      deliveryId: 'd-update',
      payload: issueUpdatePayload({ stateType: 'started' }),
    })

    expect(outcome).toMatchObject({ handled: true, kind: EFactoryEventKind.StatusChange })
    expect((await workItems.find({ workItemId: workItem.id })).status).toBe(
      EFactoryWorkItemStatus.Intake,
    )
    expect(drives.release).not.toHaveBeenCalled()
  })

  it('a comment on an aliased issue appends a comment event', async () => {
    seedConnection()
    await workItems.intake({
      organizationId: 'org_compai',
      repo: 'ENG-123',
      sourceKind: 'linear',
      surface: 'linear',
      externalId: ISSUE_ID,
      aliasKind: 'issue',
    })

    const outcome = await service.handle({ deliveryId: 'd-comment', payload: commentCreatedPayload() })

    expect(outcome).toMatchObject({ handled: true, kind: EFactoryEventKind.Comment, appended: true })
    expect(fake.transcriptEvents).toMatchObject([
      { kind: EFactoryEventKind.Comment, author: 'Dennis Lysenko' },
    ])
  })

  it('a comment on an untracked issue is not handled and nothing is stored', async () => {
    seedConnection()

    const outcome = await service.handle({ deliveryId: 'd-comment', payload: commentCreatedPayload() })

    expect(outcome).toEqual({ handled: false })
    expect(fake.transcriptEvents).toHaveLength(0)
    expect(orchestrator.wake).not.toHaveBeenCalled()
  })

  it('an unsupported event type is not handled', async () => {
    seedConnection()

    const outcome = await service.handle({
      deliveryId: 'd-1',
      payload: { action: 'create', type: 'Project', organizationId: WORKSPACE },
    })

    expect(outcome).toEqual({ handled: false })
  })
})
