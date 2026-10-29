import { EThreadListFrame, type ThreadListFrame } from '@dltech/atlas-wire'
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common'
import { request } from 'express'
import { describe, expect, it } from 'bun:test'
import { DrainStateService } from '../health/drain-state.service'
import type { SessionOrSandboxTrpcCtx } from './session-or-sandbox.middleware'
import { ThreadSignalsService } from './thread-signals.service'
import { ThreadsRouter } from './threads.router'

const ctxFor = (extra: Partial<SessionOrSandboxTrpcCtx> = {}): SessionOrSandboxTrpcCtx => ({
  req: request,
  bearerToken: undefined,
  clientVersion: undefined,
  auth: { userId: 'usr_a', sessionId: 'ses', email: '' },
  ...extra,
})

const optionsFor = (signal?: AbortSignal) => ({
  ctx: undefined,
  input: undefined,
  type: 'subscription',
  path: 'threads.listSignals',
  rawInput: undefined,
  signal,
})

function routerWith() {
  const drain = new DrainStateService()
  const signals = new ThreadSignalsService(drain)
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

const collect = (frames: AsyncGenerator<ThreadListFrame>) => {
  const seen: string[] = []
  const finished = (async () => {
    for await (const frame of frames) {
      if (frame.type === EThreadListFrame.Changed) seen.push(frame.threadId)
    }
  })()
  return { seen, finished }
}

describe('threads.listSignals', () => {
  it('relays a list frame to its user only', async () => {
    const { router, signals } = routerWith()
    const controller = new AbortController()
    const mine = collect(router.listSignals(ctxFor(), optionsFor(controller.signal)))
    const other = collect(
      router.listSignals(
        ctxFor({ auth: { userId: 'usr_b', sessionId: 'ses', email: '' } }),
        optionsFor(controller.signal),
      ),
    )
    await Promise.resolve()

    await signals.listChanged({ userId: 'usr_b', threadId: 'thr_b' })
    await signals.listChanged({ userId: 'usr_a', threadId: 'thr_a' })
    await Promise.resolve()
    controller.abort()
    await Promise.all([mine.finished, other.finished])

    expect(mine.seen).toEqual(['thr_a'])
    expect(other.seen).toEqual(['thr_b'])
  })

  it('refuses sandbox and pod principals', () => {
    const { router } = routerWith()
    const sandbox = ctxFor({ sandbox: { sandboxId: 'sbx_1', threadId: 'thr_1' } })
    const pod = ctxFor({ pod: { threadId: 'thr_1' } })

    expect(() => router.listSignals(sandbox, optionsFor())).toThrow(ForbiddenException)
    expect(() => router.listSignals(pod, optionsFor())).toThrow(ForbiddenException)
  })

  it('closes open list streams on drain and refuses new ones', async () => {
    const { router, drain } = routerWith()
    const open = router.listSignals(ctxFor(), optionsFor())
    const finished = (async () => {
      for await (const frame of open) void frame
    })()
    await Promise.resolve()

    drain.beginDrain()
    await finished

    expect(() => router.listSignals(ctxFor(), optionsFor())).toThrow(ServiceUnavailableException)
  })
})
