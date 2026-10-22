import { EThreadMessageState } from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  fakeBoot,
  messagesWith,
  sandboxRows,
  seedThread,
  serviceWith,
} from './sandbox-provisioning.fixture'
import { NOT_RUNNING_MESSAGE, SEND_PENDING_MESSAGE } from './thread-messages.service'

const ARGS = { userId: 'usr-1', threadId: 'thr-1', sendId: 'snd-1', text: 'hello' } as const
const ENDPOINT = { token: 'tok', url: 'https://serve.example.test' }

type PendingSend = { sendId: string; text: string }

async function seedRow(
  partial: { wakeClaim?: Date | null; pendingSend?: PendingSend } = {},
): Promise<void> {
  const at = new Date()
  await db.orm.public.CloudSandbox.create({
    id: 'sbx-1',
    threadId: 'thr-1',
    userId: 'usr-1',
    sandboxId: '',
    name: 'atlas-thread-1',
    region: 'iad1',
    state: 'resuming',
    lastActivityAt: at,
    tokenHash: 'hash',
    sealedToken: 'sealed',
    wakeClaim: partial.wakeClaim === undefined ? at : partial.wakeClaim,
    createdAt: at,
    updatedAt: at,
    ...(partial.pendingSend === undefined ? {} : { pendingSend: partial.pendingSend }),
  })
}

const stored = async () => (await sandboxRows())[0]?.pendingSend

const replacePending = (pendingSend: PendingSend) =>
  db.orm.public.CloudSandbox.where({ threadId: 'thr-1' }).update({ pendingSend })

describe('ThreadMessagesService', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedThread()
  })

  it('delivers at once when the sandbox is running', async () => {
    const { service, serve } = messagesWith({ endpoint: ENDPOINT })

    expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Delivered })
    expect(serve).toHaveBeenCalledWith({
      ...ENDPOINT,
      threadId: 'thr-1',
      sendId: 'snd-1',
      text: 'hello',
    })
  })

  it('answers 502 when delivery to a running sandbox fails', async () => {
    const { service } = messagesWith({ endpoint: ENDPOINT, serveFails: new Error('socket down') })

    await expect(service.send(ARGS)).rejects.toMatchObject({ status: 502 })
  })

  it("does not send to another user's thread", async () => {
    const { service, serve } = messagesWith({ endpoint: ENDPOINT })

    await expect(service.send({ ...ARGS, userId: 'usr-2' })).rejects.toThrow('thread not found')
    expect(serve).not.toHaveBeenCalled()
  })

  it('queues and persists the send while the sandbox boots', async () => {
    await seedRow()
    const { service, serve } = messagesWith({})

    expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Queued })
    expect(await stored()).toEqual({ sendId: 'snd-1', text: 'hello' })
    expect(serve).not.toHaveBeenCalled()
  })

  it('accepts a repeat of the same pending sendId', async () => {
    await seedRow({ pendingSend: { sendId: 'snd-1', text: 'hello' } })
    const { service } = messagesWith({})

    expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Queued })
  })

  it('refuses a different send while one is pending', async () => {
    await seedRow({ pendingSend: { sendId: 'snd-0', text: 'earlier' } })
    const { service } = messagesWith({})

    await expect(service.send(ARGS)).rejects.toThrow(SEND_PENDING_MESSAGE)
    expect(await stored()).toEqual({ sendId: 'snd-0', text: 'earlier' })
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
    await replacePending({ sendId: 'snd-1', text: 'hello' })
    release()
    await service.settle()

    expect(messages.serve).toHaveBeenCalledWith({
      ...ENDPOINT,
      threadId: 'thr-1',
      sendId: 'snd-1',
      text: 'hello',
    })
    expect(await stored()).toBeNull()
  })

  it('leaves the pending send in place when the drain delivery fails', async () => {
    await seedRow({ pendingSend: { sendId: 'snd-1', text: 'hello' } })
    const { service } = messagesWith({ endpoint: ENDPOINT, serveFails: new Error('socket down') })

    await expect(service.drain({ threadId: 'thr-1' })).resolves.toBeUndefined()
    expect(await stored()).toEqual({ sendId: 'snd-1', text: 'hello' })
  })

  it('keeps a newer pending send that replaced the one just delivered', async () => {
    await seedRow({ pendingSend: { sendId: 'snd-1', text: 'hello' } })
    const { service, serve } = messagesWith({ endpoint: ENDPOINT })
    serve.mockImplementationOnce(async () => {
      await replacePending({ sendId: 'snd-2', text: 'newer' })
    })

    await service.drain({ threadId: 'thr-1' })

    expect(await stored()).toEqual({ sendId: 'snd-2', text: 'newer' })
  })
})
