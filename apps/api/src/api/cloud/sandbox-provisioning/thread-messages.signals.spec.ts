import { EThreadStreamFrame } from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { recordingSignals } from '../../platform/sessions/thread-signals.fixture'
import { messagesWith, seedThread, threadRow } from './sandbox-provisioning.fixture'

const ARGS = { userId: 'usr-1', threadId: 'thr-1', sendId: 'snd-1', text: 'hello' } as const
const head = (value: number) => ({ type: EThreadStreamFrame.Head, head: value }) as const
const pod = { type: EThreadStreamFrame.Pod } as const

describe('ThreadMessagesService signals', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedThread()
  })

  it('a queued send signals the appended head', async () => {
    const { signals, framesOf } = recordingSignals()
    const frames = framesOf('thr-1')

    await messagesWith({ signals }).service.send(ARGS)

    expect(frames).toContainEqual(head(1))
  })

  it('a send that launches a pod also signals a pod change', async () => {
    const { signals, framesOf } = recordingSignals()
    const frames = framesOf('thr-1')

    await messagesWith({ signals }).service.send(ARGS)

    expect(frames).toContainEqual(pod)
  })

  it('a send to an archived thread unarchives it and signals the list', async () => {
    await db.orm.public.Thread.where({ id: 'thr-1' }).update({ archivedAt: new Date() })
    const { signals, listFramesOf } = recordingSignals()
    const listFrames = listFramesOf('usr-1')

    await messagesWith({ signals }).service.send(ARGS)

    expect((await threadRow())?.archivedAt).toBeNull()
    expect(listFrames.length).toBeGreaterThan(0)
  })

  it('a live send to an archived thread unarchives it too', async () => {
    await db.orm.public.Thread.where({ id: 'thr-1' }).update({ archivedAt: new Date() })

    await messagesWith({
      endpoint: { token: 'tok', url: 'https://serve.example.test' },
    }).service.send(ARGS)

    expect((await threadRow())?.archivedAt).toBeNull()
  })

  it('a live delivery appends nothing and signals nothing', async () => {
    const { signals, framesOf } = recordingSignals()
    const frames = framesOf('thr-1')

    await messagesWith({
      signals,
      endpoint: { token: 'tok', url: 'https://serve.example.test' },
    }).service.send(ARGS)

    expect(frames).toEqual([])
  })

  it('takeBack signals the wound-back head', async () => {
    const { signals, framesOf } = recordingSignals()
    const { service } = messagesWith({ signals })
    await service.send(ARGS)
    const frames = framesOf('thr-1')

    await service.takeBack({ userId: 'usr-1', threadId: 'thr-1', sendId: 'snd-1' })

    expect(frames).toEqual([head(0)])
  })
})
