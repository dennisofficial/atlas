import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { EPodState, EThreadStreamFrame, type ThreadStreamFrame } from '@dltech/atlas-wire'
import { afterEach, beforeEach, describe, expect, it, spyOn, mock } from 'bun:test'
import { seedSandboxRow, seedThreadRow, seedUsers, USER_A } from '../../../../test/session-seed'
import { waitFor } from '../../../../test/fake-timers'
import { DrainStateService } from '../health/drain-state.service'
import * as podStatus from '../sandboxes/pod-status'
import { PodChangePublisher } from './pod-change-publisher'
import { readPodSnapshot } from './pod-snapshot'
import { bumpAndEnrichThread } from './thread-changed'
import { attachThreadStream } from './thread-stream'
import { metadataFrame } from './thread-stream.fixture'
import { ThreadSignalsService } from './thread-signals.service'
import type { ThreadFrameSignal } from './thread-signal.bus'

describe('transaction-locked Pod snapshots', () => {
  useTestDatabase()
  let signals: ThreadSignalsService

  beforeEach(async () => {
    await seedUsers(USER_A)
    await seedThreadRow({ id: 'thr-1', userId: USER_A })
    await seedSandboxRow({ threadId: 'thr-1', state: 'resuming', wakeClaim: new Date() })
    signals = new ThreadSignalsService(new DrainStateService())
  })
  afterEach(async () => {
    await signals.changesSettled()
    signals.closeAll()
    mock.restore()
  })

  it('reads initial and reconnect snapshots without bumping rev and threads the transaction through lifecycle reads', async () => {
    await db.orm.public.Thread.where({ id: 'thr-1' }).update({ rev: 9 })
    const lifecycle = spyOn(podStatus, 'readPodLifecycle')
    expect(await readPodSnapshot({ threadId: 'thr-1' })).toMatchObject({
      rev: 9,
      status: { state: EPodState.Booting, rev: 9 },
    })
    await db.orm.public.CloudSandbox.where({ sessionId: 'ses_thr-1' }).update({
      state: 'parked',
      wakeClaim: null,
    })
    expect(await readPodSnapshot({ threadId: 'thr-1' })).toMatchObject({
      rev: 9,
      status: { state: EPodState.Parked, rev: 9 },
    })
    const reader = lifecycle.mock.calls[0]?.[0].reader
    expect(reader).toBeDefined()
    expect(reader).not.toBe(db)
    expect((await db.orm.public.Thread.where({ id: 'thr-1' }).all().firstOrThrow()).rev).toBe(9)
  })

  it('rejects a delayed Booting from an independent publisher after a newer Running publication', async () => {
    const frames: ThreadStreamFrame[] = []
    const raw: ThreadFrameSignal[] = []
    const detach = attachThreadStream({
      signals,
      threadId: 'thr-1',
      readHead: async () => 0,
      readMetadata: async () => metadataFrame({ threadId: 'thr-1' }),
      sink: { push: (frame) => frames.push(frame), close: () => {} },
    })
    const captured = Promise.withResolvers<ThreadFrameSignal>()
    const release = Promise.withResolvers<void>()
    let first: Promise<void> = Promise.resolve()
    try {
      await waitFor(() => expect(frames).toHaveLength(3))
      first = new PodChangePublisher().publish({
        threadId: 'thr-1',
        listChanged: async () => {},
        publish: async (signal) => {
          captured.resolve(signal)
          await release.promise
          raw.push(signal)
          await signals.publish(signal)
        },
      })
      expect((await captured.promise).frame).toMatchObject({
        rev: 1,
        status: { state: EPodState.Booting },
      })
      await db.orm.public.CloudSandbox.where({ sessionId: 'ses_thr-1' }).update({
        state: 'running',
        serveUrl: 'https://serve.example.test',
        wakeClaim: null,
      })
      await new PodChangePublisher().publish({
        threadId: 'thr-1',
        listChanged: async () => {},
        publish: async (signal) => {
          raw.push(signal)
          await signals.publish(signal)
        },
      })
      release.resolve()
      await first
      expect(
        raw.map(({ frame }) => (frame.type === EThreadStreamFrame.Pod ? frame.rev : undefined)),
      ).toEqual([2, 1])
      expect(frames.filter((frame) => frame.type === EThreadStreamFrame.Pod)).toMatchObject([
        { rev: 0, status: { state: EPodState.Booting } },
        { rev: 2, status: { state: EPodState.Running } },
      ])
      expect((await bumpAndEnrichThread({ threadId: 'thr-1' }))?.rev).toBe(3)
    } finally {
      release.resolve()
      await first
      detach()
    }
  })
})
