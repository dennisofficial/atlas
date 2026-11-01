import { request } from 'express'
import { localObservations } from './github-observation.fixture'
import type { GithubObservationStore } from './github-observation.store'
import type { GithubPrEventDto, GithubPrStateDto } from './github-realtime.types'
import { EPrEventKind } from './github-realtime.types'
import { DrainStateService } from '../../platform/health/drain-state.service'
import type { SessionOrSandboxTrpcCtx } from '../../platform/sessions/session-or-sandbox.middleware'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { GithubPrStreamRouter } from './github-pr-stream.router'
import type { GithubSubscriptionsService } from './github-subscriptions.service'

export const STATE: GithubPrStateDto = {
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

export const COMMENT_EVENT: GithubPrEventDto = {
  id: 'evt_1',
  repoFullName: 'compai/app',
  prNumber: 42,
  kind: EPrEventKind.Comment,
  payload: {
    url: 'https://github.com/compai/app/pull/42#issuecomment-1',
    authorLogin: 'dennis',
    body: 'ship it',
  },
  createdAt: '2026-10-08T10:00:00.000Z',
}

export const VERDICT_EVENT: GithubPrEventDto = {
  id: 'evt_2',
  repoFullName: 'compai/app',
  prNumber: 42,
  kind: EPrEventKind.Verdict,
  payload: { url: 'https://github.com/compai/app/pull/42', verdict: 'failed', headSha: 'abc' },
  createdAt: '2026-10-08T11:00:00.000Z',
}

export const ctxFor = (userId: string): SessionOrSandboxTrpcCtx => ({
  req: request,
  bearerToken: undefined,
  clientVersion: undefined,
  auth: { userId, sessionId: 'ses', email: '' },
})

export const podCtxFor = (args: { userId: string; threadId: string }): SessionOrSandboxTrpcCtx => ({
  ...ctxFor(args.userId),
  pod: { threadId: args.threadId },
})

export const optionsFor = (signal?: AbortSignal) => ({
  ctx: undefined,
  input: undefined,
  type: 'subscription',
  path: 'githubPrs.stream',
  rawInput: undefined,
  signal,
})

type StreamFakes = {
  states?: GithubPrStateDto[] | Error
  undelivered?: GithubPrEventDto[] | Error
  threadMissed?: GithubPrEventDto[]
}

export const fakeSubscriptions = (states: StreamFakes['states'] = []) => ({
  currentStates: async (): Promise<GithubPrStateDto[]> => {
    if (states instanceof Error) throw states
    return states
  },
})

export const fakeMailbox = (
  undelivered: StreamFakes['undelivered'] = [],
  threadMissed: StreamFakes['threadMissed'] = [],
) => ({
  replayUndelivered: async (): Promise<GithubPrEventDto[]> => {
    if (undelivered instanceof Error) throw undelivered
    return undelivered
  },
  replayForThread: async (): Promise<GithubPrEventDto[]> => threadMissed,
})

export function routerWith(fakes: StreamFakes = {}): {
  router: GithubPrStreamRouter
  fanout: GithubPrFanoutService
  drain: DrainStateService
  mailbox: GithubPrEventMailboxService
  observations: GithubObservationStore
} {
  const drain = new DrainStateService()
  const fanout = new GithubPrFanoutService(drain)
  const mailbox = fakeMailbox(
    fakes.undelivered,
    fakes.threadMissed,
  ) as unknown as GithubPrEventMailboxService
  const observations = localObservations()
  const router = new GithubPrStreamRouter(
    fanout,
    fakeSubscriptions(fakes.states) as unknown as GithubSubscriptionsService,
    drain,
    mailbox,
    observations,
  )
  return { router, fanout, drain, mailbox, observations }
}
