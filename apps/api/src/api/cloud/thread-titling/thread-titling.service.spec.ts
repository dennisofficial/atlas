import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { Logger } from '@nestjs/common'
import { describe, expect, it, vi } from 'bun:test'
import { recordingSignals } from '../../platform/sessions/thread-signals.fixture'
import { seedThread, threadRow } from '../sandbox-provisioning/sandbox-provisioning.fixture'
import { ThreadTitlingService, type TitlerFactory } from './thread-titling.service'

const sessionTitle = async () => {
  const thread = await threadRow()
  if (thread === null) return undefined
  return (await db.orm.public.Session.first({ id: thread.sessionId }))?.title
}

const REQUEST = { userId: 'usr-1', threadId: 'thr-1', projectId: 'prj-1', text: 'fix login' }

function serviceWith(args: { titler: () => Promise<string | null> }) {
  const factory = vi.fn((_settings: Parameters<TitlerFactory>[0]) => args.titler)
  const { signals, framesOf, changedThreads } = recordingSignals()
  const config = { resolveForPod: vi.fn(async () => ({ settings: { 'model.quickModel': 'x/y' } })) }
  const accounts = { lease: vi.fn(async () => ({ accounts: [], active: [] })) }
  const service = new ThreadTitlingService(
    config as never,
    accounts as never,
    {} as never,
    signals,
    factory as unknown as TitlerFactory,
  )
  return { service, factory, framesOf, changedThreads }
}

describe('ThreadTitlingService', () => {
  useTestDatabase()

  it('writes the generated title and signals the thread change', async () => {
    await seedThread()
    const { service, factory, framesOf, changedThreads } = serviceWith({
      titler: async () => 'Fix login',
    })
    const frames = framesOf('thr-1')

    await service.titleFirstMessage(REQUEST)

    expect(await sessionTitle()).toBe('Fix login')
    expect(frames).toHaveLength(0)
    expect(changedThreads).toEqual(['thr-1'])
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('does not overwrite an existing title', async () => {
    await seedThread()
    const thread = await threadRow()
    await db.orm.public.Session.where({ id: thread?.sessionId ?? '' }).update({ title: 'Mine' })
    const { service, framesOf } = serviceWith({ titler: async () => 'Generated' })
    const frames = framesOf('thr-1')

    await service.titleFirstMessage(REQUEST)

    expect(await sessionTitle()).toBe('Mine')
    expect(frames).toHaveLength(0)
  })

  it('names a session with the model the session itself runs on when the quick model cannot answer', async () => {
    const { service, factory } = serviceWith({ titler: async () => 'Fix login' })

    await service.nameOf({
      userId: 'usr-1',
      projectId: 'prj-1',
      text: 'fix login',
      modelRef: 'gateway/deepseek/deepseek-v4.1-flash-1017-fast',
    })

    expect(factory.mock.calls[0]?.[0].fallbackRef).toEqual({
      providerId: 'gateway',
      modelId: 'deepseek/deepseek-v4.1-flash-1017-fast',
    })
  })

  it('logs the reason a titling pass reported instead of leaving it silent', async () => {
    await seedThread()
    const warned = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      const { service, factory } = serviceWith({ titler: async () => null })

      await service.titleFirstMessage(REQUEST)
      factory.mock.calls[0]?.[0].onFault?.(
        new Error('This request would exceed your account monthly spend limit'),
      )

      const line = String(warned.mock.calls.at(-1)?.[0])
      expect(line).toContain('titling thr-1 failed:')
      expect(line).toContain('monthly spend limit')
    } finally {
      warned.mockRestore()
    }
  })

  it('swallows a titler failure and leaves the thread untitled', async () => {
    await seedThread()
    const { service } = serviceWith({
      titler: async () => {
        throw new Error('boom')
      },
    })

    await service.titleFirstMessage(REQUEST)

    expect(await sessionTitle()).toBeNull()
  })
})
