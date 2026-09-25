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
import { ReplyWatchService } from './reply-watch.service'
import { WorkItemsService } from '../work-items.service'

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
    channel.inject.mockImplementation(async (args: { threadId: string; text: string; witness: { commitLanded: () => Promise<boolean>; delivered: (proof: string) => Promise<void> } }) => {
      fake.events.push({
        id: `evt_${fake.events.length + 1}`,
        threadId: args.threadId,
        seq: fake.events.length + 1,
        type: 'user-said',
        body: JSON.stringify({ type: 'user-said', text: args.text }),
      })
      await args.witness.commitLanded()
      await args.witness.delivered('committed')
    })
  })

  const watchArmed = async (eventId: string) => {
    service.watch({ workItemId, ref, eventId })
    await vi.waitFor(() =>
      expect(fake.replyWatches.some((one) => one.workItemId === workItemId)).toBe(true),
    )
  }

  it('sets the heard signal when a watch is armed', async () => {
    await watchArmed('evt_human_1')
    expect(signals.set).toHaveBeenCalledWith({ ref, signal: EStatusSignal.Heard })
    await service.resolve({ workItemId })
  })

  it('nudges the orchestrator when no reply lands within the window', async () => {
    await watchArmed('evt_human_1')

    await vi.waitFor(() => expect(channel.inject).toHaveBeenCalled(), { timeout: WINDOW * 4 })

    const text = (channel.inject.mock.calls[0]?.[0] as { text: string }).text
    expect(text).toContain('<system-notice kind="reply-watch"')
    expect(text).toContain(ref.externalId)
  })

  it('does not nudge before the window passes', async () => {
    await watchArmed('evt_human_1')

    await new Promise((resolve) => setTimeout(resolve, WINDOW / 2))

    expect(channel.inject).not.toHaveBeenCalled()
  })

  it('does not nudge when a reply lands on the surface before the window', async () => {
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

    await watchArmed('evt_human_1')
    await new Promise((resolve) => setTimeout(resolve, WINDOW * 2))

    expect(channel.inject).not.toHaveBeenCalled()
    expect(fake.replyWatches).toHaveLength(0)
  })

  it('resolve marks reply-coming and clears the signals', async () => {
    await watchArmed('evt_human_1')

    await service.resolve({ workItemId })

    expect(signals.set).toHaveBeenCalledWith({ ref, signal: EStatusSignal.ReplyComing })
    expect(signals.clear).toHaveBeenCalledWith({ ref })
    expect(fake.replyWatches).toHaveLength(0)
    // And the timer is disarmed: no nudge even after the window passes.
    await new Promise((resolve) => setTimeout(resolve, WINDOW * 2))
    expect(channel.inject).not.toHaveBeenCalled()
  })

  it('nudges once, then stands down after the grace window', async () => {
    await watchArmed('evt_human_1')

    await vi.waitFor(() => expect(channel.inject).toHaveBeenCalledTimes(1), { timeout: WINDOW * 4 })
    await new Promise((resolve) => setTimeout(resolve, GRACE * 2))

    expect(channel.inject).toHaveBeenCalledTimes(1)
    expect(fake.replyWatches).toHaveLength(0)
  })

  it('persists the watch deadlines, so a fresh instance re-arms them after a restart', async () => {
    await watchArmed('evt_human_1')
    expect(fake.replyWatches).toHaveLength(1)
    const row = fake.replyWatches[0]!
    expect(row.eventId).toBe('evt_human_1')
    expect(Date.parse(row.nudgeAt)).toBeGreaterThan(Date.now())
    expect(Date.parse(row.graceAt)).toBeGreaterThan(Date.parse(row.nudgeAt))

    // The first instance is gone; only its durable row survives into the restarted one.
    const surviving = { ...row }
    await service.resolve({ workItemId }).catch(() => undefined)
    signals.clear.mockClear()
    channel.inject.mockClear()
    fake.replyWatches.push(surviving)

    const restarted = new ReplyWatchService(
      signals as never,
      sandboxes as unknown as SandboxesService,
      new FactoryIdentityService(nullCipher),
      channel as OrchestratorChannel,
    )
    restarted.windowMs = WINDOW
    restarted.graceMs = GRACE
    await restarted.onApplicationBootstrap()

    await vi.waitFor(() => expect(channel.inject).toHaveBeenCalled(), { timeout: WINDOW * 4 })
    const text = (channel.inject.mock.calls[0]?.[0] as { text: string }).text
    expect(text).toContain('<system-notice kind="reply-watch"')
    expect(fake.replyWatches[0]?.nudged).toBe(true)
  })

  it('re-arming a watch whose window passed while down fires the nudge immediately', async () => {
    await watchArmed('evt_human_1')
    const row = fake.replyWatches[0]!
    row.nudgeAt = new Date(Date.now() - 1).toISOString()

    // Same restart: the old instance is dismantled, the row's deadline is already in the past.
    const surviving = { ...row }
    await service.resolve({ workItemId }).catch(() => undefined)
    channel.inject.mockClear()
    fake.replyWatches.push(surviving)

    const restarted = new ReplyWatchService(
      signals as never,
      sandboxes as unknown as SandboxesService,
      new FactoryIdentityService(nullCipher),
      channel as OrchestratorChannel,
    )
    await restarted.onApplicationBootstrap()

    await vi.waitFor(() => expect(channel.inject).toHaveBeenCalled(), { timeout: WINDOW })
  })
})
