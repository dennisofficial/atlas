import { ServiceUnavailableException, type MessageEvent } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { GithubPrStreamController } from './github-pr-stream.controller'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { EPrRealtimeEvent, type GithubPrStateDto } from './github-realtime.types'
import type { GithubSubscriptionsService } from './github-subscriptions.service'

const STATE: GithubPrStateDto = {
  repoFullName: 'compai/app',
  prNumber: 42,
  title: 'add the thing',
  url: 'https://github.com/compai/app/pull/42',
  state: 'open',
  headBranch: 'dennis/add-the-thing',
  headSha: 'abc123',
  checksRunning: 0,
  checksPassed: 3,
  checksFailed: 0,
  mergeable: true,
  updatedAt: '2026-09-28T00:00:00.000Z',
}

function controllerWith(args: { states?: GithubPrStateDto[] } = {}): {
  controller: GithubPrStreamController
  fanout: GithubPrFanoutService
  drain: DrainStateService
} {
  const drain = new DrainStateService()
  const fanout = new GithubPrFanoutService(drain)
  const subscriptions = {
    currentStates: async () => args.states ?? [],
  } as unknown as GithubSubscriptionsService
  return {
    controller: new GithubPrStreamController(fanout, subscriptions, drain),
    fanout,
    drain,
  }
}

function requestFor(userId: string): AuthenticatedRequest {
  return { auth: { userId } } as unknown as AuthenticatedRequest
}

describe('GithubPrStreamController', () => {
  it('refuses to open a stream once the process is draining', () => {
    const { controller, drain } = controllerWith()
    drain.beginDrain()

    expect(() => controller.handleStream(requestFor('usr_1'))).toThrow(
      ServiceUnavailableException,
    )
  })

  it('replays the cached states on open, then pushes live frames', async () => {
    const { controller, fanout } = controllerWith({ states: [STATE] })
    const frames: MessageEvent[] = []

    const subscription = controller
      .handleStream(requestFor('usr_1'))
      .subscribe({ next: (frame) => frames.push(frame) })
    await vi.waitFor(() => expect(frames).toHaveLength(1))
    fanout.push({ userIds: ['usr_1'], state: { ...STATE, checksPassed: 4 } })
    subscription.unsubscribe()

    expect(frames[0]).toEqual({ type: EPrRealtimeEvent.PrState, data: STATE })
    expect(frames[1]).toEqual({ type: EPrRealtimeEvent.PrState, data: { ...STATE, checksPassed: 4 } })
  })

  it('completes the stream when the drain closes the fanout', async () => {
    const { controller, drain } = controllerWith()
    const stream = controller.handleStream(requestFor('usr_1'))

    let completed = false
    const finished = new Promise<void>((resolve) => {
      stream.subscribe({ complete: () => { completed = true; resolve() } })
    })
    drain.beginDrain()

    await finished
    expect(completed).toBe(true)
  })

  it('still opens the stream when the state replay fails', async () => {
    const drain = new DrainStateService()
    const fanout = new GithubPrFanoutService(drain)
    const subscriptions = {
      currentStates: async (): Promise<GithubPrStateDto[]> => {
        throw new Error('database is gone')
      },
    } as unknown as GithubSubscriptionsService
    const controller = new GithubPrStreamController(fanout, subscriptions, drain)
    const frames: MessageEvent[] = []

    const subscription = controller
      .handleStream(requestFor('usr_1'))
      .subscribe({ next: (frame) => frames.push(frame) })
    fanout.push({ userIds: ['usr_1'], state: STATE })
    subscription.unsubscribe()

    await vi.waitFor(() => expect(frames).toHaveLength(1))
    expect(frames[0]).toEqual({ type: EPrRealtimeEvent.PrState, data: STATE })
  })
})
