import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
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
  const factory = vi.fn(() => args.titler) as unknown as TitlerFactory
  const { signals, framesOf, listFramesOf } = recordingSignals()
  const config = { resolveForPod: vi.fn(async () => ({ settings: { 'model.quickModel': 'x/y' } })) }
  const accounts = { lease: vi.fn(async () => ({ accounts: [], active: [] })) }
  const service = new ThreadTitlingService(
    config as never,
    accounts as never,
    {} as never,
    signals,
    factory,
  )
  return { service, factory, framesOf, listFramesOf }
}

describe('ThreadTitlingService', () => {
  useTestDatabase()

  it('writes the generated title and signals the thread and list', async () => {
    await seedThread()
    const { service, factory, framesOf, listFramesOf } = serviceWith({
      titler: async () => 'Fix login',
    })
    const frames = framesOf('thr-1')
    const listFrames = listFramesOf('usr-1')

    await service.titleFirstMessage(REQUEST)

    expect(await sessionTitle()).toBe('Fix login')
    expect(frames).toHaveLength(1)
    expect(listFrames).toHaveLength(1)
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
