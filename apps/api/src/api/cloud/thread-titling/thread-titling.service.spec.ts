import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { Logger } from '@nestjs/common'
import { describe, expect, it, vi } from 'bun:test'
import { recordingSignals } from '../../platform/sessions/thread-signals.fixture'
import { seedThread, threadRow } from '../sandbox-provisioning/sandbox-provisioning.fixture'
import type { SessionNamer } from '../../../agent'
import { ThreadTitlingService } from './thread-titling.service'

const sessionTitle = async () => {
  const thread = await threadRow()
  if (thread === null) return undefined
  return (await db.orm.public.Session.first({ id: thread.sessionId }))?.title
}

const REQUEST = { userId: 'usr-1', threadId: 'thr-1', projectId: 'prj-1', text: 'fix login' }

type NamerAsk = Parameters<SessionNamer>[0]

function serviceWith(args: { titler: () => Promise<string | null> }) {
  const namer = vi.fn((_ask: NamerAsk) => args.titler())
  const { signals, framesOf, changedThreads } = recordingSignals()
  const service = new ThreadTitlingService(signals, namer)
  return { service, namer, framesOf, changedThreads }
}

describe('ThreadTitlingService', () => {
  useTestDatabase()

  it('writes the generated title and signals the thread change', async () => {
    await seedThread()
    const { service, namer, framesOf, changedThreads } = serviceWith({
      titler: async () => 'Fix login',
    })
    const frames = framesOf('thr-1')

    await service.titleFirstMessage(REQUEST)

    expect(await sessionTitle()).toBe('Fix login')
    expect(frames).toHaveLength(0)
    expect(changedThreads).toEqual(['thr-1'])
    expect(namer).toHaveBeenCalledTimes(1)
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

  it('hands the session model to the namer as the fallback, with a timeout', async () => {
    const { service, namer } = serviceWith({ titler: async () => 'Fix login' })

    await service.nameOf({
      userId: 'usr-1',
      projectId: 'prj-1',
      text: 'fix login',
      modelRef: 'gateway/deepseek/deepseek-v4.1-flash-1017-fast',
    })

    expect(namer.mock.calls[0]?.[0].modelRef).toBe('gateway/deepseek/deepseek-v4.1-flash-1017-fast')
    expect(namer.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal)
  })

  it('logs the reason a titling pass reported instead of leaving it silent', async () => {
    await seedThread()
    const warned = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      const { service, namer } = serviceWith({ titler: async () => null })

      await service.titleFirstMessage(REQUEST)
      namer.mock.calls[0]?.[0].onFault?.(
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
