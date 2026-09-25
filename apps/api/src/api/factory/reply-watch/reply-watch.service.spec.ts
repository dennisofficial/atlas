import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeFactoryDb } = await import('../../../../test/fake-factory-db.js')
  return { db: fakeFactoryDb().db as unknown as PrismaClient }
})

import { fakeFactoryDb } from '../../../../test/fake-factory-db.js'
import type { SandboxesService } from '../../platform/sandboxes/sandboxes.service'
import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { FactoryIdentityService } from '../orchestrator/factory-identity'
import type { OrchestratorChannel } from '../orchestrator/orchestrator-channel'
import { EFactoryEventKind, EFactorySurface } from '../factory.types'
import { EStatusSignal, type StatusSignalRef } from '../status-signal/status-signal'
import { WorkItemsService } from '../work-items.service'
import { EReplyWatchStatus, ReplyWatchService } from './reply-watch.service'

const nullCipher = null as unknown as SecretCipherService
const WINDOW = 1000
const GRACE = 1000

const INTAKE = {
  organizationId: 'org_atlas_default',
  repo: 'dennisofficial/factory-scratch',
  sourceKind: 'github',
  surface: 'github',
  externalId: 'dennisofficial/factory-scratch#12',
  aliasKind: 'issue',
}

const ref: StatusSignalRef = {
  surface: EFactorySurface.GitHub,
  organizationId: 'org_atlas_default',
  externalId: 'dennisofficial/factory-scratch#12',
  commentId: '9001',
}

describe('ReplyWatchService', () => {
  const fake = fakeFactoryDb()
  let signals: { set: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> }
  let sandboxes: {
    runningEndpoint: ReturnType<typeof vi.fn>
    attach: ReturnType<typeof vi.fn>
    whenSettled: ReturnType<typeof vi.fn>
    status: ReturnType<typeof vi.fn>
  }
  let channel: { inject: ReturnType<typeof vi.fn> }
  let service: ReplyWatchService
  let workItemId: string

  /** Shift the watch row's clock into the past so the sweep treats it as due. */
  const ageWatch = (ms: number) => {
    for (const row of fake.replyWatches) {
      row.nudgeAt = new Date(Date.parse(row.nudgeAt) - ms).toISOString()
      row.expireAt = new Date(Date.parse(row.expireAt) - ms).toISOString()
    }
  }

  const pushReply = () => {
    fake.transcriptEvents.push({
      id: 'evt_reply',
      workItemId,
      surface: ref.surface,
      externalId: ref.externalId,
      deliveryId: 'reply:1',
      kind: EFactoryEventKind.Reply,
      author: 'atlas-factory',
      payload: '{}',
      receivedAt: new Date().toISOString(),
      seq: 1,
    } as never)
  }

  beforeEach(async () => {
    fake.reset()
    signals = { set: vi.fn(async () => undefined), clear: vi.fn(async () => undefined) }
    sandboxes = {
      runningEndpoint: vi.fn(async () => ({ token: 'tok', url: 'https://orch-3000.vercel.run' })),
      attach: vi.fn(async () => ({ token: 'tok' })),
      whenSettled: vi.fn(async () => undefined),
      status: vi.fn(async () => ({ name: 'factory-orchestrator', url: 'https://orch-3000.vercel.run' })),
    }
    channel = { inject: vi.fn(async () => undefined) }
    service = new ReplyWatchService(
      signals as never,
      sandboxes as unknown as SandboxesService,
      new FactoryIdentityService(nullCipher),
      channel as OrchestratorChannel,
    )
    service.windowMs = WINDOW
    service.graceMs = GRACE
    const workItems = new WorkItemsService()
    const { workItem } = await workItems.intake(INTAKE)
    workItemId = workItem.id
    fake.workItems[0]!.orchestratorThreadId = 'brn_orchestrator_1'
    // The watch needs an event log commit for the nudge marker to confirm against.
    channel.inject.mockImplementation(async (args: { threadId: string; text: string; accepted: () => Promise<boolean> }) => {
      fake.events.push({
        id: `evt_${fake.events.length + 1}`,
        threadId: args.threadId,
        seq: fake.events.length + 1,
        type: 'user-said',
        body: JSON.stringify({ type: 'user-said', text: args.text }),
      })
      await args.accepted()
    })
  })

  it('sets the heard signal and records a durable watch row when armed', async () => {
    await service.watch({ workItemId, ref, eventId: 'evt_human_1' })

    expect(signals.set).toHaveBeenCalledWith({ ref, signal: EStatusSignal.Heard })
    expect(fake.replyWatches).toHaveLength(1)
    expect(fake.replyWatches[0]?.status).toBe(EReplyWatchStatus.Pending)
    await service.resolve({ workItemId })
  })

  it('nudges the orchestrator when the window has passed and no reply has landed', async () => {
    await service.watch({ workItemId, ref, eventId: 'evt_human_1' })
    ageWatch(WINDOW + 1)

    const nudged = await service.sweep()

    expect(nudged).toBe(1)
    expect(channel.inject).toHaveBeenCalledTimes(1)
    const text = (channel.inject.mock.calls[0]?.[0] as { text: string }).text
    expect(text).toContain('<system-notice kind="reply-watch"')
    expect(text).toContain(ref.externalId)
  })

  it('does not nudge before the window passes', async () => {
    await service.watch({ workItemId, ref, eventId: 'evt_human_1' })

    const nudged = await service.sweep()

    expect(nudged).toBe(0)
    expect(channel.inject).not.toHaveBeenCalled()
  })

  it('resolves the row without a nudge when a reply has landed on the surface', async () => {
    pushReply()
    await service.watch({ workItemId, ref, eventId: 'evt_human_1' })
    ageWatch(WINDOW + 1)

    const nudged = await service.sweep()

    expect(nudged).toBe(0)
    expect(channel.inject).not.toHaveBeenCalled()
    expect(fake.replyWatches[0]?.status).toBe(EReplyWatchStatus.Resolved)
  })

  it('resolve marks reply-coming, resolves the row, and clears the signals', async () => {
    await service.watch({ workItemId, ref, eventId: 'evt_human_1' })

    await service.resolve({ workItemId })

    expect(signals.set).toHaveBeenCalledWith({ ref, signal: EStatusSignal.ReplyComing })
    expect(signals.clear).toHaveBeenCalledWith({ ref })
    expect(fake.replyWatches[0]?.status).toBe(EReplyWatchStatus.Resolved)
    ageWatch(WINDOW + GRACE + 1)
    await service.sweep()
    expect(channel.inject).not.toHaveBeenCalled()
  })

  it('nudges once, then stands down after the grace window', async () => {
    await service.watch({ workItemId, ref, eventId: 'evt_human_1' })
    ageWatch(WINDOW + 1)
    await service.sweep()
    expect(channel.inject).toHaveBeenCalledTimes(1)

    ageWatch(GRACE + 1)
    await service.sweep()

    expect(channel.inject).toHaveBeenCalledTimes(1)
    expect(fake.replyWatches[0]?.status).toBe(EReplyWatchStatus.StoodDown)
  })

  it('a fresh watch survives being re-read from the database across sweeps (no in-process timer)', async () => {
    await service.watch({ workItemId, ref, eventId: 'evt_human_1' })
    // Simulate a restart: nothing in memory carries the watch, only the row.
    ageWatch(WINDOW + 1)

    const nudged = await service.sweep()

    expect(nudged).toBe(1)
    expect(channel.inject).toHaveBeenCalledTimes(1)
  })
})
