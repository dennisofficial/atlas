import { EThreadLiveFrame, type ThreadLiveFrame } from '@dltech/atlas-wire'
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { request } from 'express'
import { describe, expect, it } from 'bun:test'
import { seedThreadRow, seedUsers, USER_A } from '../../../../test/session-seed'
import { DrainStateService } from '../health/drain-state.service'
import type { SessionOrSandboxTrpcCtx } from './session-or-sandbox.middleware'
import { InProcessThreadSignalBus } from './thread-signal.bus'
import { ThreadSignalsService } from './thread-signals.service'
import { ThreadsRouter } from './threads.router'

const ctxFor = (extra: Partial<SessionOrSandboxTrpcCtx> = {}): SessionOrSandboxTrpcCtx => ({
  req: request,
  bearerToken: undefined,
  clientVersion: undefined,
  auth: { userId: USER_A, sessionId: 'ses', email: '' },
  ...extra,
})

const until = async (ready: () => boolean): Promise<void> => {
  const deadline = Date.now() + 5000
  while (!ready()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the stream')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

const optionsFor = (signal?: AbortSignal) => ({
  ctx: undefined,
  input: undefined,
  type: 'subscription',
  path: 'threads.live',
  rawInput: undefined,
  signal,
})

function routerWith() {
  const drain = new DrainStateService()
  const signals = new ThreadSignalsService(drain, new InProcessThreadSignalBus())
  const router = new ThreadsRouter(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    signals,
    drain,
  )
  return { router, signals, drain }
}

const collect = (stream: AsyncGenerator<ThreadLiveFrame>) => {
  const seen: ThreadLiveFrame[] = []
  const finished = (async () => {
    for await (const frame of stream) seen.push(frame)
  })()
  return { seen, finished }
}

describe('threads.live', () => {
  useTestDatabase()

  it('emits a snapshot then live upserts for the owner only', async () => {
    await seedUsers(USER_A, 'usr_b')
    await seedThreadRow({ id: 'thr-mine', userId: USER_A, title: 'mine' })
    const { router, signals } = routerWith()
    const controller = new AbortController()
    const mine = collect(router.live(ctxFor(), optionsFor(controller.signal)))
    const other = collect(
      router.live(
        ctxFor({ auth: { userId: 'usr_b', sessionId: 'ses', email: '' } }),
        optionsFor(controller.signal),
      ),
    )
    await until(
      () =>
        mine.seen.some((frame) => frame.type === EThreadLiveFrame.Snapshot) &&
        other.seen.some((frame) => frame.type === EThreadLiveFrame.Snapshot),
    )

    signals.threadChanged({ threadId: 'thr-mine' })
    await signals.changesSettled()
    await until(() => mine.seen.some((frame) => frame.type === EThreadLiveFrame.Upsert))
    controller.abort()
    await Promise.all([mine.finished, other.finished])

    const mySnapshot = mine.seen.find((frame) => frame.type === EThreadLiveFrame.Snapshot)
    if (mySnapshot?.type !== EThreadLiveFrame.Snapshot) throw new Error('no snapshot')
    expect(mySnapshot.rows.map((row) => row.thread.id)).toEqual(['thr-mine'])
    const myUpserts = mine.seen.filter((frame) => frame.type === EThreadLiveFrame.Upsert)
    expect(myUpserts).toHaveLength(1)

    const otherSnapshot = other.seen.find((frame) => frame.type === EThreadLiveFrame.Snapshot)
    if (otherSnapshot?.type !== EThreadLiveFrame.Snapshot) throw new Error('no snapshot')
    expect(otherSnapshot.rows).toEqual([])
    expect(other.seen.filter((frame) => frame.type === EThreadLiveFrame.Upsert)).toEqual([])
  })

  it('refuses sandbox and pod principals', () => {
    const { router } = routerWith()
    const sandbox = ctxFor({ sandbox: { sandboxId: 'sbx_1', threadId: 'thr_1' } })
    const pod = ctxFor({ pod: { threadId: 'thr_1' } })

    expect(() => router.live(sandbox, optionsFor())).toThrow(ForbiddenException)
    expect(() => router.live(pod, optionsFor())).toThrow(ForbiddenException)
  })

  it('closes open live streams on drain and refuses new ones', async () => {
    await seedUsers(USER_A)
    const { router, drain } = routerWith()
    const open = router.live(ctxFor(), optionsFor())
    const finished = (async () => {
      for await (const frame of open) void frame
    })()

    drain.beginDrain()
    await finished

    expect(() => router.live(ctxFor(), optionsFor())).toThrow(ServiceUnavailableException)
  })
})
