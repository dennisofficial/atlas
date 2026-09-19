import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../generated/prisma/client'

vi.mock('../../db', async () => {
  const { fakeFactoryDb } = await import('../../../test/fake-factory-db.js')
  return { db: fakeFactoryDb().db as unknown as PrismaClient }
})

import { fakeFactoryDb } from '../../../test/fake-factory-db.js'
import { TranscriptService } from './transcript.service'
import { WorkItemsService } from './work-items.service'

const INTAKE = {
  repo: 'compai/atlas',
  sourceKind: 'github',
  surface: 'github',
  externalId: 'compai/atlas#341',
  aliasKind: 'issue',
}

const COMMENT = {
  surface: 'github',
  externalId: 'compai/atlas#341',
  kind: 'comment',
  author: 'dennislysenko',
  authorAssociation: 'owner',
  payload: JSON.stringify({ body: 'cap at 1000rpm is fine for now' }),
}

describe('TranscriptService', () => {
  const fake = fakeFactoryDb()
  let transcript: TranscriptService
  let workItemId: string

  beforeEach(async () => {
    fake.reset()
    transcript = new TranscriptService()
    const { workItem } = await new WorkItemsService().intake(INTAKE)
    workItemId = workItem.id
  })

  it('append records the event against the aliased work item', async () => {
    const result = await transcript.append({ ...COMMENT, deliveryId: 'd-1' })

    expect(result).not.toBeNull()
    expect(result?.appended).toBe(true)
    expect(result?.workItemId).toBe(workItemId)
    expect(result?.event).toMatchObject({
      surface: 'github',
      author: 'dennislysenko',
      authorAssociation: 'owner',
      kind: 'comment',
    })
  })

  it('a redelivered webhook appends once and reports the replay', async () => {
    const first = await transcript.append({ ...COMMENT, deliveryId: 'd-1' })
    const replay = await transcript.append({ ...COMMENT, deliveryId: 'd-1' })

    expect(first?.appended).toBe(true)
    expect(replay?.appended).toBe(false)
    expect(replay?.event.id).toBe(first?.event.id)
    expect(fake.transcriptEvents).toHaveLength(1)
  })

  it('the same delivery id on a different surface is a different event', async () => {
    await new WorkItemsService().registerAlias({
      workItemId,
      surface: 'linear',
      externalId: 'COMP-88',
      kind: 'ticket',
    })

    await transcript.append({ ...COMMENT, deliveryId: 'd-1' })
    const linear = await transcript.append({ ...COMMENT, surface: 'linear', externalId: 'COMP-88', deliveryId: 'd-1' })

    expect(linear?.appended).toBe(true)
    expect(linear?.workItemId).toBe(workItemId)
    expect(fake.transcriptEvents).toHaveLength(2)
  })

  it('a redelivery that loses the create race reports the replay instead of erroring', async () => {
    const first = await transcript.append({ ...COMMENT, deliveryId: 'd-race' })

    const findFirst = fake.db.factoryTranscriptEvent.findFirst.bind(fake.db.factoryTranscriptEvent)
    let missesLeft = 1
    fake.db.factoryTranscriptEvent.findFirst = (async (args: Parameters<typeof findFirst>[0]) => {
      if (missesLeft > 0) {
        missesLeft -= 1
        return null
      }
      return findFirst(args)
    }) as unknown as typeof findFirst

    let raced: Awaited<ReturnType<TranscriptService['append']>>
    try {
      raced = await transcript.append({ ...COMMENT, deliveryId: 'd-race' })
    } finally {
      fake.db.factoryTranscriptEvent.findFirst = findFirst
    }

    expect(raced?.appended).toBe(false)
    expect(raced?.event.id).toBe(first?.event.id)
    expect(fake.transcriptEvents.filter((one) => one.deliveryId === 'd-race')).toHaveLength(1)
  })

  it('an event on an unknown surface is dropped, not stored', async () => {
    const result = await transcript.append({
      ...COMMENT,
      externalId: 'compai/atlas#999',
      deliveryId: 'd-9',
    })

    expect(result).toBeNull()
    expect(fake.transcriptEvents).toHaveLength(0)
  })

  it('appending bumps the work item activity clock', async () => {
    fake.workItems[0]!.lastActivityAt = '2026-09-01T00:00:00.000Z'
    fake.workItems[0]!.updatedAt = '2026-09-01T00:00:00.000Z'

    await transcript.append({ ...COMMENT, deliveryId: 'd-1' })

    const after = await new WorkItemsService().find({ workItemId })
    expect(after.lastActivityAt > '2026-09-01T00:00:00.000Z').toBe(true)
    expect(after.updatedAt > '2026-09-01T00:00:00.000Z').toBe(true)
  })

  it('list returns the transcript oldest first', async () => {
    await transcript.append({ ...COMMENT, deliveryId: 'd-1' })
    await transcript.append({ ...COMMENT, deliveryId: 'd-2', kind: 'review' })

    const listed = await transcript.list({ workItemId })

    expect(listed.map((event) => event.deliveryId)).toEqual(['d-1', 'd-2'])
    expect(listed.map((event) => event.kind)).toEqual(['comment', 'review'])
  })
})
