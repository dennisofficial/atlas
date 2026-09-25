import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeFactoryDb } = await import('../../../../test/fake-factory-db.js')
  return { db: fakeFactoryDb().db as unknown as PrismaClient }
})

import { fakeFactoryDb } from '../../../../test/fake-factory-db.js'
import type { SandboxesService } from '../../platform/sandboxes/sandboxes.service'
import { ESandboxFactoryRole } from '../../platform/sandboxes/sandboxes.types'
import type { ThreadsService } from '../../platform/sessions/threads.service'
import type { FactoryDrivesService } from '../drives/drives.service'
import { DEFAULT_ORGANIZATION_ID, EFactoryEventKind } from '../factory.types'
import { TranscriptService } from '../transcript.service'
import { WorkItemsService } from '../work-items.service'
import type { FactoryCredentialService } from './factory-credentials'
import { FactoryIdentityService } from './factory-identity'
import type { OrchestratorChannel } from './orchestrator-channel'
import { OrchestratorService } from './orchestrator.service'
import { WakeLockService } from './wake-lock'
import { WakeRecoveryService } from './wake-recovery'
import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'

const nullCipher = null as unknown as SecretCipherService

const INTAKE = {
  organizationId: DEFAULT_ORGANIZATION_ID,
  repo: 'compai/atlas',
  sourceKind: 'github',
  surface: 'github',
  externalId: 'compai/atlas#341',
  aliasKind: 'issue',
}

const LIVE_ENDPOINT = { token: 'tok_sealed', url: 'https://factory-x-3000.vercel.run' }

type InjectCall = { text: string; token: string; url: string; accepted: () => Promise<boolean> }

describe('OrchestratorService', () => {
  const fake = fakeFactoryDb()
  let workItems: WorkItemsService
  let transcript: TranscriptService
  let identity: FactoryIdentityService
  let threads: { create: ReturnType<typeof vi.fn> }
  let sandboxes: {
    runningEndpoint: ReturnType<typeof vi.fn>
    attach: ReturnType<typeof vi.fn>
    whenSettled: ReturnType<typeof vi.fn>
    status: ReturnType<typeof vi.fn>
  }
  let channel: { inject: ReturnType<typeof vi.fn> }
  let credentials: {
    ensureSeeded: ReturnType<typeof vi.fn>
    modelRef: ReturnType<typeof vi.fn>
    decisionsUrl: ReturnType<typeof vi.fn>
  }
  let drives: { ensure: ReturnType<typeof vi.fn> }
  let service: OrchestratorService
  let wakeRecovery: WakeRecoveryService
  let eventSeq: number

  const appendEvent = async (workItemId: string, marker: string) => {
    eventSeq += 1
    const result = await transcript.append({
      surface: 'github',
      externalId: INTAKE.externalId,
      deliveryId: `d-${eventSeq}`,
      kind: EFactoryEventKind.Comment,
      author: 'dennislysenko',
      authorAssociation: 'owner',
      payload: `{"marker":"${marker}"}`,
    })
    expect(result?.workItemId).toBe(workItemId)
    return result?.event
  }

  const wake = async (workItemId: string) => {
    await service.wakeNow({ workItemId, externalId: INTAKE.externalId })
  }

  const sentTexts: string[] = []
  const injectedTexts = (): string[] => sentTexts

  beforeEach(() => {
    fake.reset()
    sentTexts.length = 0
    eventSeq = 0
    workItems = new WorkItemsService()
    transcript = new TranscriptService()
    identity = new FactoryIdentityService(nullCipher)
    threads = {
      create: vi.fn(async ({ userId, draft }: { userId: string; draft: { title?: string } }) => {
        const id = `brn_orchestrator_${fake.threads.length + 1}`
        fake.threads.push({ id, head: 0, userId, title: draft.title })
        return { id, title: draft.title }
      }),
    }
    sandboxes = {
      runningEndpoint: vi.fn(async () => null),
      attach: vi.fn(async ({ threadId, name }: { threadId: string; name?: string }) => ({
        threadId,
        name: name ?? 'atlas-thread-x',
        region: 'iad1',
        state: 'resuming',
        lastActivityAt: '2026-09-19T00:00:00.000Z',
        token: 'tok_fresh',
      })),
      whenSettled: vi.fn(async () => undefined),
      status: vi.fn(async ({ threadId }: { threadId: string }) => ({
        threadId,
        name: 'factory-x',
        region: 'iad1',
        state: 'running',
        lastActivityAt: '2026-09-19T00:00:00.000Z',
        url: 'https://factory-x-3000.vercel.run',
      })),
    }
    credentials = {
      ensureSeeded: vi.fn(async () => undefined),
      modelRef: vi.fn(async () => 'inference/kimi-k3-fast'),
      decisionsUrl: vi.fn(async () => undefined),
    }
    drives = { ensure: vi.fn(async () => 'factory-compai-atlas-341') }
    wakeRecovery = new WakeRecoveryService(transcript)
    channel = {
      inject: vi.fn(async (args: InjectCall & { threadId: string; witness: { commitLanded: () => Promise<boolean>; delivered: (proof: string) => Promise<void> } }) => {
        if (await args.witness.commitLanded()) {
          await args.witness.delivered('committed')
          return
        }
        sentTexts.push(args.text)
        fake.events.push({
          id: `evt_${fake.events.length + 1}`,
          threadId: args.threadId,
          seq: fake.events.length + 1,
          type: 'user-said',
          body: JSON.stringify({ type: 'user-said', text: args.text }),
        })
        await args.witness.delivered('socket-accepted')
      }),
    }
    service = new OrchestratorService(
      workItems,
      transcript,
      threads as unknown as ThreadsService,
      sandboxes as unknown as SandboxesService,
      identity,
      credentials as unknown as FactoryCredentialService,
      drives as unknown as FactoryDrivesService,
      new WakeLockService(),
      wakeRecovery,
      channel as OrchestratorChannel,
    )
    wakeRecovery.registerDriver(service)
  })

  it('first wake creates a thread as the factory user and injects instructions with the event', async () => {
    const { workItem } = await workItems.intake(INTAKE)
    const event = await appendEvent(workItem.id, 'first')
    await wake(workItem.id)

    expect(threads.create).toHaveBeenCalledTimes(1)
    const createArgs = threads.create.mock.calls[0]?.[0] as {
      userId: string
      draft: { title: string; repo: string }
    }
    expect(createArgs.draft.title).toBe('factory: compai/atlas#341')
    expect(createArgs.draft.repo).toBe('compai/atlas')
    expect(fake.users[0]?.email).toBe(`factory+${DEFAULT_ORGANIZATION_ID}@atlas.internal`)
    expect(createArgs.userId).toBe(fake.users[0]?.id)

    const updated = await workItems.find({ workItemId: workItem.id })
    expect(updated.orchestratorThreadId).toBe('brn_orchestrator_1')
    expect(updated.orchestratorDeliveredEventId).toBe(event?.id ?? '')

    expect(channel.inject).toHaveBeenCalledTimes(1)
    const text = injectedTexts()[0] as string
    expect(text).toContain('factory orchestrator')
    expect(text).toContain(`[factory event] ${event?.id ?? ''}`)
    expect(text).toContain('{"marker":"first"}')
  })

  it('provisions the sandbox under the factory name for the work item', async () => {
    const { workItem } = await workItems.intake(INTAKE)
    await appendEvent(workItem.id, 'named')
    await wake(workItem.id)

    const attachArgs = sandboxes.attach.mock.calls[0]?.[0] as {
      name: string
      factoryRole?: ESandboxFactoryRole
    }
    expect(attachArgs.name).toBe(`factory-${workItem.id.replaceAll('_', '-')}`)
    expect(attachArgs.factoryRole).toBe(ESandboxFactoryRole.Orchestrator)
  })

  it('a wake ensures the drive and mounts it as a read-only snapshot', async () => {
    const { workItem } = await workItems.intake(INTAKE)
    await appendEvent(workItem.id, 'drive')
    await wake(workItem.id)

    expect(drives.ensure).toHaveBeenCalledWith({ workItemId: workItem.id })
    const attachArgs = sandboxes.attach.mock.calls[0]?.[0] as {
      drive?: { name: string; mode: string }
    }
    expect(attachArgs.drive).toEqual({ name: 'factory-compai-atlas-341', mode: 'snapshot' })
  })

  it('a wake with nothing pending does not touch the sandbox', async () => {
    const { workItem } = await workItems.intake(INTAKE)
    await appendEvent(workItem.id, 'only')
    await wake(workItem.id)
    await wake(workItem.id)

    expect(sandboxes.attach).toHaveBeenCalledTimes(1)
    expect(channel.inject).toHaveBeenCalledTimes(1)
  })

  it('a second event wakes the running sandbox through its sealed token, without re-attaching', async () => {
    const { workItem } = await workItems.intake(INTAKE)
    await appendEvent(workItem.id, 'one')
    await wake(workItem.id)

    sandboxes.runningEndpoint.mockResolvedValue(LIVE_ENDPOINT)
    await appendEvent(workItem.id, 'two')
    await wake(workItem.id)

    expect(sandboxes.attach).toHaveBeenCalledTimes(1)
    expect(channel.inject).toHaveBeenCalledTimes(2)
    const second = channel.inject.mock.calls[1]?.[0] as InjectCall
    expect(second.token).toBe('tok_sealed')
    const text = injectedTexts()[1] as string
    expect(text).not.toContain('factory orchestrator')
    expect(text).toContain('{"marker":"two"}')
  })

  it('a wake that fails before delivery keeps the instructions and the event for the next wake', async () => {
    const { workItem } = await workItems.intake(INTAKE)
    const event = await appendEvent(workItem.id, 'doomed')
    sandboxes.status.mockRejectedValueOnce(new Error('provision exploded'))

    await expect(wake(workItem.id)).rejects.toThrow('provision exploded')
    expect(channel.inject).not.toHaveBeenCalled()

    await wake(workItem.id)
    expect(threads.create).toHaveBeenCalledTimes(1)
    expect(channel.inject).toHaveBeenCalledTimes(1)
    const text = injectedTexts()[0] as string
    expect(text).toContain('factory orchestrator')
    expect(text).toContain(`[factory event] ${event?.id ?? ''}`)
    const updated = await workItems.find({ workItemId: workItem.id })
    expect(updated.orchestratorDeliveredEventId).toBe(event?.id ?? '')
  })

  it('a wake seeds the factory model credentials before provisioning', async () => {
    const { workItem } = await workItems.intake(INTAKE)
    await appendEvent(workItem.id, 'seeded')
    await wake(workItem.id)

    expect(credentials.ensureSeeded).toHaveBeenCalledWith({
      userId: fake.users[0]?.id,
      organizationId: DEFAULT_ORGANIZATION_ID,
    })
    expect(sandboxes.attach).toHaveBeenCalledTimes(1)
  })

  it('reply events the orchestrator caused are never delivered back to it', async () => {
    const { workItem } = await workItems.intake(INTAKE)
    await appendEvent(workItem.id, 'first')
    await wake(workItem.id)

    const transcriptService = transcript
    await transcriptService.append({
      surface: 'github',
      externalId: INTAKE.externalId,
      deliveryId: 'reply:self-1',
      kind: EFactoryEventKind.Reply,
      author: 'atlas-factory',
      payload: '{"body":"triage"}',
    })

    sandboxes.runningEndpoint.mockResolvedValue(LIVE_ENDPOINT)
    await wake(workItem.id)
    expect(channel.inject).toHaveBeenCalledTimes(1)

    await appendEvent(workItem.id, 'second')
    await wake(workItem.id)
    const texts = injectedTexts()
    expect(texts).toHaveLength(2)
    expect(texts[1]).toContain('{"marker":"second"}')
    expect(texts.some((text) => text.includes('reply:self-1'))).toBe(false)
  })

  it('one wake drains every pending event in order', async () => {
    const { workItem } = await workItems.intake(INTAKE)
    await appendEvent(workItem.id, 'first')
    await appendEvent(workItem.id, 'second')
    await appendEvent(workItem.id, 'third')
    await wake(workItem.id)

    const texts = injectedTexts()
    expect(texts).toHaveLength(3)
    expect(texts[0]).toContain('{"marker":"first"}')
    expect(texts[1]).toContain('{"marker":"second"}')
    expect(texts[2]).toContain('{"marker":"third"}')
  })

  it('a delivery that landed but lost its wake is not injected twice', async () => {
    const { workItem } = await workItems.intake(INTAKE)
    const event = await appendEvent(workItem.id, 'landed')
    fake.events.push({
      id: 'evt_pre',
      threadId: 'brn_orchestrator_1',
      seq: 1,
      type: 'user-said',
      body: JSON.stringify({ type: 'user-said', text: `[factory event] ${event?.id ?? ''}` }),
    })
    const fresh = await appendEvent(workItem.id, 'fresh')
    await wake(workItem.id)

    const texts = injectedTexts()
    expect(texts).toHaveLength(1)
    expect(texts[0]).toContain('{"marker":"fresh"}')
    const updated = await workItems.find({ workItemId: workItem.id })
    expect(updated.orchestratorDeliveredEventId).toBe(fresh?.id ?? '')
  })

  it('a transient error on the cached endpoint retries on a fresh socket without re-attaching', async () => {
    const { workItem } = await workItems.intake(INTAKE)
    await appendEvent(workItem.id, 'one')
    await wake(workItem.id)

    sandboxes.runningEndpoint.mockResolvedValue(LIVE_ENDPOINT)
    await appendEvent(workItem.id, 'blip')
    channel.inject.mockRejectedValueOnce(new Error('edge closed the socket'))
    await wake(workItem.id)

    expect(sandboxes.attach).toHaveBeenCalledTimes(1)
    expect(channel.inject).toHaveBeenCalledTimes(3)
    const retried = channel.inject.mock.calls[2]?.[0] as InjectCall
    expect(retried.token).toBe('tok_sealed')
    expect(retried.text).toContain('{"marker":"blip"}')
  })

  it('a dead cached endpoint falls back to attach and retries the same event', async () => {
    const { workItem } = await workItems.intake(INTAKE)
    await appendEvent(workItem.id, 'one')
    await wake(workItem.id)

    sandboxes.runningEndpoint.mockResolvedValue(LIVE_ENDPOINT)
    await appendEvent(workItem.id, 'retry')
    channel.inject.mockRejectedValueOnce(new Error('socket refused'))
    channel.inject.mockRejectedValueOnce(new Error('socket refused again'))
    await wake(workItem.id)

    expect(sandboxes.attach).toHaveBeenCalledTimes(2)
    expect(channel.inject).toHaveBeenCalledTimes(4)
    const retried = channel.inject.mock.calls[3]?.[0] as InjectCall
    expect(retried.token).toBe('tok_fresh')
    expect(retried.text).toContain('{"marker":"retry"}')
  })

  it('a committed event whose socket died before the ack is not injected twice on retry', async () => {
    const { workItem } = await workItems.intake(INTAKE)
    await appendEvent(workItem.id, 'one')
    await wake(workItem.id)

    sandboxes.runningEndpoint.mockResolvedValue(LIVE_ENDPOINT)
    const landed = await appendEvent(workItem.id, 'landed-quietly')
    channel.inject.mockImplementationOnce(async () => {
      fake.events.push({
        id: `evt_${fake.events.length + 1}`,
        threadId: 'brn_orchestrator_1',
        seq: fake.events.length + 1,
        type: 'user-said',
        body: JSON.stringify({ type: 'user-said', text: `[factory event] ${landed?.id ?? ''}` }),
      })
      throw new Error('socket died after the commit')
    })
    await wake(workItem.id)

    expect(sandboxes.attach).toHaveBeenCalledTimes(1)
    expect(channel.inject).toHaveBeenCalledTimes(2)
    const userSaid = fake.events.filter((one) => one.type === 'user-said')
    expect(userSaid.filter((one) => one.body.includes(landed?.id ?? ''))).toHaveLength(1)
    const updated = await workItems.find({ workItemId: workItem.id })
    expect(updated.orchestratorDeliveredEventId).toBe(landed?.id ?? '')
  })

  it('a wake whose first provision fails still delivers after re-attaching to a running sandbox', async () => {
    const { workItem } = await workItems.intake(INTAKE)
    const event = await appendEvent(workItem.id, 'initializer')
    sandboxes.status.mockRejectedValueOnce(
      new Error('The drive has not been initialized yet. Please mount as read-write first.'),
    )

    await expect(wake(workItem.id)).rejects.toThrow('not been initialized')
    expect(channel.inject).not.toHaveBeenCalled()

    sandboxes.runningEndpoint.mockResolvedValue(LIVE_ENDPOINT)
    await wake(workItem.id)

    expect(channel.inject).toHaveBeenCalledTimes(1)
    const text = injectedTexts()[0] as string
    expect(text).toContain('factory orchestrator')
    expect(text).toContain(`[factory event] ${event?.id ?? ''}`)
    const updated = await workItems.find({ workItemId: workItem.id })
    expect(updated.orchestratorDeliveredEventId).toBe(event?.id ?? '')
  })

  it('a restart re-drives a wake the previous instance abandoned, adopting its thread', async () => {
    const { workItem } = await workItems.intake(INTAKE)
    const event = await appendEvent(workItem.id, 'orphaned')
    sandboxes.status.mockRejectedValueOnce(new Error('the container was replaced mid-wake'))
    await expect(wake(workItem.id)).rejects.toThrow('replaced mid-wake')
    expect(channel.inject).not.toHaveBeenCalled()

    const restartedRecovery = new WakeRecoveryService(transcript)
    const restarted = new OrchestratorService(
      workItems,
      transcript,
      threads as unknown as ThreadsService,
      sandboxes as unknown as SandboxesService,
      identity,
      credentials as unknown as FactoryCredentialService,
      drives as unknown as FactoryDrivesService,
      new WakeLockService(),
      restartedRecovery,
      channel as OrchestratorChannel,
    )
    restartedRecovery.registerDriver(restarted)
    restartedRecovery.onApplicationBootstrap()
    await vi.waitFor(() => expect(channel.inject).toHaveBeenCalled())

    expect(threads.create).toHaveBeenCalledTimes(1)
    expect(channel.inject).toHaveBeenCalledTimes(1)
    const text = injectedTexts()[0] as string
    expect(text).toContain('factory orchestrator')
    expect(text).toContain(`[factory event] ${event?.id ?? ''}`)
    const updated = await workItems.find({ workItemId: workItem.id })
    expect(updated.orchestratorThreadId).toBe('brn_orchestrator_1')
    expect(updated.orchestratorDeliveredEventId).toBe(event?.id ?? '')
  })
})
