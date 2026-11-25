import { request } from 'express'
import { localCoordinator } from '@dltech/atlas-github/testing'
import type { GithubRequestCoordinator } from '@dltech/atlas-github'
import type { GithubPrEventDto, GithubPrStateDto } from '@dltech/atlas-github'
import { EPrEventKind } from '@dltech/atlas-github'
import { DrainStateService } from '../../platform/health/drain-state.service'
import type { SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { GithubPrEventMailboxService } from '@dltech/atlas-github'
import { GithubPrFanoutService } from '@dltech/atlas-github'
import { GithubPrStreamRouter } from './github-pr-stream.router'
import type { GithubSubscriptionsService } from '@dltech/atlas-github'
import type { GithubService } from '@dltech/atlas-github'
import { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'

export const fakeGithub = (tokens: Record<string, string> = { usr_1: 'ghu_1' }) =>
  ({
    findToken: async ({ userId }: { userId: string }) => tokens[userId],
  }) as unknown as GithubService

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
  checksIgnored: 0,
  checksState: null,
  mergeable: true,
  version: 1,
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

export const ctxFor = (userId: string): SessionTrpcCtx => ({
  req: request,
  bearerToken: undefined,
  clientVersion: undefined,
  auth: { userId, sessionId: 'ses', email: '' },
})

export const podCtxFor = (args: { userId: string; threadId: string }): SessionTrpcCtx => ({
  ...ctxFor(args.userId),
  pod: { threadId: args.threadId },
})

export const sandboxCtxFor = (args: {
  userId: string
  sandboxId: string
  threadId: string
}): SessionTrpcCtx => ({
  ...ctxFor(args.userId),
  sandbox: { sandboxId: args.sandboxId, threadId: args.threadId },
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
  github?: GithubService
  signals?: ThreadSignalsService
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
  acks: Array<{ threadId: string; eventIds: readonly string[] }> = [],
) => ({
  replayUndelivered: async (): Promise<GithubPrEventDto[]> => {
    if (undelivered instanceof Error) throw undelivered
    return undelivered
  },
  replayForThread: async (): Promise<GithubPrEventDto[]> => threadMissed,
  acknowledge: async (args: { threadId: string; eventIds: readonly string[] }) => {
    acks.push(args)
    return args.eventIds.length
  },
})

export const fakeSandboxes = (family: { root: string; children?: readonly string[] }) => ({
  assertThreadInFamily: async (args: {
    sandboxThreadId: string
    threadId: string
  }): Promise<void> => {
    if (args.threadId === args.sandboxThreadId) return
    if (args.sandboxThreadId === family.root && (family.children ?? []).includes(args.threadId))
      return
    throw new Error('the sandbox token reaches only its own thread and its sub-agents')
  },
})

export function routerWith(fakes: StreamFakes = {}): {
  router: GithubPrStreamRouter
  fanout: GithubPrFanoutService
  drain: DrainStateService
  mailbox: GithubPrEventMailboxService
  coordinator: GithubRequestCoordinator
  github: GithubService
  signals: ThreadSignalsService
} {
  const drain = new DrainStateService()
  const fanout = new GithubPrFanoutService(drain)
  const mailbox = fakeMailbox(
    fakes.undelivered,
    fakes.threadMissed,
  ) as unknown as GithubPrEventMailboxService
  const github = fakes.github ?? fakeGithub()
  const signals = fakes.signals ?? new ThreadSignalsService(new DrainStateService())
  const coordinator = localCoordinator(github)
  const router = new GithubPrStreamRouter(
    fanout,
    fakeSubscriptions(fakes.states) as unknown as GithubSubscriptionsService,
    drain,
    mailbox,
    coordinator,
    github,
    signals,
  )
  return { router, fanout, drain, mailbox, coordinator, github, signals }
}
