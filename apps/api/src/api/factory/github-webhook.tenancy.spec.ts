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
import { DEFAULT_ORGANIZATION_ID } from './factory.types'
import { GithubWebhookService } from './github-webhook.service'
import type { OrchestratorService } from './orchestrator/orchestrator.service'
import type { GithubAppService } from './reply/github-app.service'
import type { ReplyWatchService } from './reply-watch/reply-watch.service'
import type { StationsService } from './stations/stations.service'
import { TranscriptService } from './transcript.service'
import { WorkItemsService } from './work-items.service'

const REPO = 'compai/atlas'

function issuesLabeledPayload(args: { installationId?: number } = {}): unknown {
  return {
    action: 'labeled',
    issue: { number: 341 },
    label: { name: 'atlas-factory' },
    repository: { full_name: REPO },
    sender: { login: 'dennislysenko' },
    ...(args.installationId === undefined ? {} : { installation: { id: args.installationId } }),
  }
}

describe('GithubWebhookService tenancy', () => {
  const fake = fakeFactoryDb()
  let service: GithubWebhookService
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fake.reset()
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    service = new GithubWebhookService(
      new WorkItemsService(),
      new FactoryConnectionsService(),
      new TranscriptService(),
      { wake: vi.fn() } as unknown as OrchestratorService,
      {
        botLogin: vi.fn(async () => null),
        ownsAppId: vi.fn(() => false),
        addIssueReaction: vi.fn(async () => undefined),
      } as unknown as GithubAppService,
      { release: vi.fn(async () => true) } as unknown as FactoryDrivesService,
      { stopRunningFor: vi.fn(async () => undefined) } as unknown as StationsService,
      { watch: vi.fn(), resolve: vi.fn(async () => undefined) } as unknown as ReplyWatchService,
    )
  })

  it('an installation with a matching connection intakes into that organization', async () => {
    fake.connections.push({
      id: 'fco_1',
      organizationId: 'org_compai',
      provider: 'github',
      externalAccountId: '87123',
      sealedCredentials: null,
      scopes: null,
      status: 'active',
      createdAt: '2026-09-22T00:00:00.000Z',
      updatedAt: '2026-09-22T00:00:00.000Z',
    })

    const outcome = await service.handle({
      event: 'issues',
      deliveryId: 'd-1',
      payload: issuesLabeledPayload({ installationId: 87123 }),
    })

    expect(outcome.handled).toBe(true)
    expect(fake.workItems).toHaveLength(1)
    expect(fake.workItems[0]?.organizationId).toBe('org_compai')
    expect(warn).not.toHaveBeenCalled()
  })

  it('an unknown installation falls back to the default organization with a warning', async () => {
    const outcome = await service.handle({
      event: 'issues',
      deliveryId: 'd-1',
      payload: issuesLabeledPayload({ installationId: 99999 }),
    })

    expect(outcome.handled).toBe(true)
    expect(fake.workItems[0]?.organizationId).toBe(DEFAULT_ORGANIZATION_ID)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('99999'))
  })

  it('a payload without an installation falls back to the default organization with a warning', async () => {
    const outcome = await service.handle({
      event: 'issues',
      deliveryId: 'd-1',
      payload: issuesLabeledPayload(),
    })

    expect(outcome.handled).toBe(true)
    expect(fake.workItems[0]?.organizationId).toBe(DEFAULT_ORGANIZATION_ID)
    expect(warn).toHaveBeenCalled()
  })
})
