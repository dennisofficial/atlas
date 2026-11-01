import { EBootStep, EBootStepState, EThreadStreamFrame } from '@dltech/atlas-wire'
import { EVercelCredentialGap } from '@dltech/atlas-wire/web'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { recordBootSteps } from '../../platform/sandboxes/sandbox-boot-steps'
import { recordingSignals } from '../../platform/sessions/thread-signals.fixture'
import { VercelNotConfiguredError } from '../scoped-config/scoped-config.errors'
import {
  fakeScoped,
  messagesWith,
  seedProvisionedRow,
  seedThread,
  sessionRow,
} from './sandbox-provisioning.fixture'

const ARGS = { userId: 'usr-1', threadId: 'thr-1', sendId: 'snd-1', text: 'hello' } as const
const head = (args: { head: number; historyRev: number }) =>
  ({ type: EThreadStreamFrame.Head, ...args }) as const
const pod = expect.objectContaining({ type: EThreadStreamFrame.Pod, status: expect.any(Object) })

describe('ThreadMessagesService signals', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedThread()
  })

  it('a queued send signals the appended head', async () => {
    const { signals, framesOf } = recordingSignals()
    const frames = framesOf('thr-1')

    await messagesWith({ signals }).service.send(ARGS)

    expect(frames).toContainEqual(head({ head: 1, historyRev: 0 }))
    expect(frames).toContainEqual({
      type: EThreadStreamFrame.Events,
      fromSeq: 1,
      historyRev: 0,
      events: [expect.objectContaining({ seq: 1, type: 'user-said' })],
    })
  })

  it('a send that launches a pod also signals a pod change', async () => {
    const { signals, framesOf } = recordingSignals()
    const frames = framesOf('thr-1')

    await messagesWith({ signals }).service.send(ARGS)

    expect(frames).toContainEqual(pod)
  })

  it('a send to an archived thread unarchives it and signals the thread change', async () => {
    await db.orm.public.Session.where({ id: 'ses_thr-1' }).update({ archivedAt: new Date() })
    const { signals, changedThreads } = recordingSignals()

    await messagesWith({ signals }).service.send(ARGS)

    expect((await sessionRow())?.archivedAt).toBeNull()
    expect(changedThreads).toContain('thr-1')
  })

  it('a duplicate sendId appends nothing and signals no events', async () => {
    const { signals, framesOf } = recordingSignals()
    const { service } = messagesWith({ signals })
    await service.send(ARGS)
    await recordBootSteps({
      threadId: 'thr-1',
      steps: [{ step: EBootStep.Provision, state: EBootStepState.Running }],
    })
    const frames = framesOf('thr-1')

    await service.send(ARGS)

    expect(frames.filter((frame) => frame.type !== EThreadStreamFrame.Pod)).toEqual([])
  })

  it('a send to a booting pod signals the head but no pod change', async () => {
    await seedProvisionedRow()
    const { signals, framesOf } = recordingSignals()
    const frames = framesOf('thr-1')

    await messagesWith({ signals }).service.send(ARGS)

    expect(frames).toContainEqual(head({ head: 1, historyRev: 0 }))
    expect(frames).not.toContainEqual(pod)
  })

  it('a credential gap signals the kept message and a pod change', async () => {
    const failure = new VercelNotConfiguredError(EVercelCredentialGap.UserCredential)
    const scoped = fakeScoped({ vercelCredentials: vi.fn(async () => Promise.reject(failure)) })
    const { signals, framesOf } = recordingSignals()
    const frames = framesOf('thr-1')

    await messagesWith({ signals, scoped }).service.send(ARGS)

    expect(frames).toContainEqual(head({ head: 1, historyRev: 0 }))
    expect(frames).toContainEqual(pod)
  })

  it('takeBack signals the wound-back head', async () => {
    const { signals, framesOf } = recordingSignals()
    const { service } = messagesWith({ signals })
    await service.send(ARGS)
    const frames = framesOf('thr-1')

    await service.takeBack({ userId: 'usr-1', threadId: 'thr-1', sendId: 'snd-1' })

    expect(frames).toEqual([
      { type: EThreadStreamFrame.Reset, head: 0, historyRev: 1 },
      head({ head: 0, historyRev: 1 }),
    ])
  })
})
