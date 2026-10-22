import { EThreadMessageState } from '@dltech/atlas-wire'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { PrismaClient } from '../../../generated/prisma/client'
import { provisioningFakeDb } from '../../../../test/sandbox-provisioning-fake-db'

mock.module('../../../db', () => ({
  db: provisioningFakeDb().db as unknown as PrismaClient,
}))

import { fake, fakeBoot, messagesWith, seedThread, serviceWith } from './sandbox-provisioning.fixture'
import { NOT_RUNNING_MESSAGE, SEND_PENDING_MESSAGE } from './thread-messages.service'

const ARGS = { userId: 'usr-1', threadId: 'thr-1', sendId: 'snd-1', text: 'hello' } as const
const ENDPOINT = { token: 'tok', url: 'https://serve.example.test' }
const NOW = () => new Date().toISOString()

function seedRow(partial: { wakeClaim?: string | null; pendingSend?: unknown } = {}): void {
  fake.sandboxes.push({
    id: 'sbx-1',
    threadId: 'thr-1',
    userId: 'usr-1',
    name: 'atlas-thread-1',
    state: 'resuming',
    serveUrl: null,
    tokenHash: 'hash',
    sealedToken: 'sealed',
    wakeClaim: partial.wakeClaim === undefined ? NOW() : partial.wakeClaim,
    wakeFailedAt: null,
    pendingSend: partial.pendingSend ?? null,
    runtimeCheckpoint: null,
    runtimeCheckpointRevision: null,
  })
}

const stored = () => fake.sandboxes[0]?.pendingSend

describe('ThreadMessagesService', () => {
  beforeEach(() => {
    fake.reset()
    seedThread()
  })

  it('delivers at once when the sandbox is running', async () => {
    const { service, serve } = messagesWith({ endpoint: ENDPOINT })

    expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Delivered })
    expect(serve).toHaveBeenCalledWith({ ...ENDPOINT, threadId: 'thr-1', sendId: 'snd-1', text: 'hello' })
  })

  it('answers 502 when delivery to a running sandbox fails', async () => {
    const { service } = messagesWith({ endpoint: ENDPOINT, serveFails: new Error('socket down') })

    await expect(service.send(ARGS)).rejects.toMatchObject({ status: 502 })
  })

  it('does not send to another user\'s thread', async () => {
    const { service, serve } = messagesWith({ endpoint: ENDPOINT })

    await expect(service.send({ ...ARGS, userId: 'usr-2' })).rejects.toThrow('thread not found')
    expect(serve).not.toHaveBeenCalled()
  })

  it('queues and persists the send while the sandbox boots', async () => {
    seedRow()
    const { service, serve } = messagesWith({})

    expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Queued })
    expect(stored()).toEqual({ sendId: 'snd-1', text: 'hello' })
    expect(serve).not.toHaveBeenCalled()
  })

  it('accepts a repeat of the same pending sendId', async () => {
    seedRow({ pendingSend: { sendId: 'snd-1', text: 'hello' } })
    const { service } = messagesWith({})

    expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Queued })
  })

  it('refuses a different send while one is pending', async () => {
    seedRow({ pendingSend: { sendId: 'snd-0', text: 'earlier' } })
    const { service } = messagesWith({})

    await expect(service.send(ARGS)).rejects.toThrow(SEND_PENDING_MESSAGE)
    expect(stored()).toEqual({ sendId: 'snd-0', text: 'earlier' })
  })

  it('refuses when no sandbox was started', async () => {
    const { service } = messagesWith({})

    await expect(service.send(ARGS)).rejects.toThrow(NOT_RUNNING_MESSAGE)
  })

  it('delivers and clears the pending send when the boot finishes', async () => {
    const messages = messagesWith({ endpoint: ENDPOINT })
    let release: () => void = () => undefined
    const { boot } = fakeBoot({ held: new Promise<void>((resolve) => (release = resolve)) })
    const service = serviceWith({ boot, messages: messages.service })
    await service.provision({ userId: 'usr-1', threadId: 'thr-1' })
    fake.sandboxes[0]!.pendingSend = { sendId: 'snd-1', text: 'hello' }
    release()
    await service.settle()

    expect(messages.serve).toHaveBeenCalledWith({ ...ENDPOINT, threadId: 'thr-1', sendId: 'snd-1', text: 'hello' })
    expect(stored()).toBeNull()
  })

  it('leaves the pending send in place when the drain delivery fails', async () => {
    seedRow({ pendingSend: { sendId: 'snd-1', text: 'hello' } })
    const { service } = messagesWith({ endpoint: ENDPOINT, serveFails: new Error('socket down') })

    await expect(service.drain({ threadId: 'thr-1' })).resolves.toBeUndefined()
    expect(stored()).toEqual({ sendId: 'snd-1', text: 'hello' })
  })

  it('keeps a newer pending send that replaced the one just delivered', async () => {
    seedRow({ pendingSend: { sendId: 'snd-1', text: 'hello' } })
    const { service, serve } = messagesWith({ endpoint: ENDPOINT })
    serve.mockImplementationOnce(async () => {
      fake.sandboxes[0]!.pendingSend = { sendId: 'snd-2', text: 'newer' }
    })

    await service.drain({ threadId: 'thr-1' })

    expect(stored()).toEqual({ sendId: 'snd-2', text: 'newer' })
  })
})
