import { EGithubPrStatesFrame, type GithubPrStatesFrame } from '@dltech/atlas-wire'
import { Logger } from '@nestjs/common'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { stubGlobal, unstubAllGlobals } from '@dltech/bun-test-shims'
import { afterEach, describe, expect, it, setSystemTime, vi } from 'bun:test'
import { waitFor } from '../../../../test/fake-timers'
import { seedPrState } from '../../../../test/github-seed'
import { DrainStateService } from '../../platform/health/drain-state.service'
import type { ThreadChangedSignal } from '../../platform/sessions/thread-signal.bus'
import type { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import { GithubPrFanoutService } from '@dltech/atlas-github'
import { LinkedPrAccess } from '@dltech/atlas-github'
import { seedLinkedPr } from '@dltech/atlas-github/testing'
import { attachPrStates, PR_STATES_HEARTBEAT_MS } from './github-pr-states.stream'
import type { GithubPrStateDto } from '@dltech/atlas-github'
import { localCoordinator } from '@dltech/atlas-github/testing'
import type { GithubService } from '@dltech/atlas-github'
import type { GithubSubscriptionsService } from '@dltech/atlas-github'

const OWNER = 'usr_1'
const TOKENS: Record<string, string> = { [OWNER]: 'ghu_owner' }

const LINKED: GithubPrStateDto = {
  repoFullName: 'compai/app',
  prNumber: 42,
  title: 'add the thing',
  url: 'https://github.com/compai/app/pull/42',
  state: 'open',
  headBranch: 'dennis/add-the-thing',
  headSha: 'abc123',
  checksRunning: 0,
  checksPassed: 2,
  checksFailed: 0,
  checksIgnored: 0,
  checksState: null,
  mergeable: true,
  version: 1,
  updatedAt: '2026-09-28T00:00:00.000Z',
}

const subscribedState = (prNumber: number): GithubPrStateDto => ({
  ...LINKED,
  prNumber,
  title: 'subscribed',
  url: `https://github.com/compai/other/pull/${prNumber}`,
  repoFullName: 'compai/other',
})

const githubOf = () =>
  ({
    findToken: async ({ userId }: { userId: string }) => TOKENS[userId],
  }) as unknown as GithubService

const allowRepos = (allowed: readonly string[]) => {
  const calls: string[] = []
  stubGlobal(
    'fetch',
    vi.fn(async (target: Parameters<typeof fetch>[0]) => {
      const url = String(target)
      calls.push(url)
      const repo = new URL(url).pathname.replace('/repos/', '')
      return allowed.includes(repo)
        ? Response.json({ full_name: repo }, { status: 200 })
        : Response.json({}, { status: 404 })
    }),
  )
  return calls
}

const signalRig = () => {
  const state: { listener: ((signal: ThreadChangedSignal) => void) | undefined } = {
    listener: undefined,
  }
  const signals = {
    watchThreadChanges: (args: {
      userId: string
      onChanged: (signal: ThreadChangedSignal) => void
    }) => {
      state.listener = args.onChanged
      return () => {
        state.listener = undefined
      }
    },
  } as unknown as ThreadSignalsService
  const signalFor = (prs: readonly { repo: string; number: number }[]): ThreadChangedSignal =>
    ({
      userId: OWNER,
      threadId: 'thr_1',
      rev: 2,
      thread: {
        pullRequests: prs.map((pr) => ({ ...pr, url: '', branch: 'dennis/x' })),
      },
      session: {},
    }) as unknown as ThreadChangedSignal
  return { signals, state, signalFor }
}

type Rig = ReturnType<typeof rig>

function rig(args: {
  subscribed?: readonly GithubPrStateDto[]
  signals: ThreadSignalsService
  access?: LinkedPrAccess
}) {
  const github = githubOf()
  const coordinator = localCoordinator(github)
  const fanout = new GithubPrFanoutService(new DrainStateService())
  const seen: GithubPrStatesFrame[] = []
  let closed = false
  const detach = attachPrStates({
    userId: OWNER,
    sink: { push: (frame) => seen.push(frame), close: () => (closed = true) },
    fanout,
    subscriptions: {
      currentStates: async () => [...(args.subscribed ?? [])],
    } as unknown as GithubSubscriptionsService,
    access: args.access ?? new LinkedPrAccess({ coordinator, github }),
    signals: args.signals,
    logger: new Logger('github-pr-states.stream.spec'),
  })
  return { fanout, seen, detach, coordinator, states: () => prStates(seen), isClosed: () => closed }
}

const prStates = (frames: readonly GithubPrStatesFrame[]) =>
  frames.flatMap((frame) => (frame.type === EGithubPrStatesFrame.PrState ? [frame.state] : []))

const opened: Rig[] = []
const open = (args: {
  subscribed?: readonly GithubPrStateDto[]
  signals: ThreadSignalsService
  access?: LinkedPrAccess
}) => {
  const held = rig(args)
  opened.push(held)
  return held
}

describe('attachPrStates', () => {
  useTestDatabase()

  afterEach(() => {
    for (const held of opened.splice(0)) held.detach()
    setSystemTime()
    unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('replays the cached states of subscribed and linked PRs and beats once', async () => {
    await seedLinkedPr({ userId: OWNER, threadId: 'thr_1' })
    await seedPrState({ prNumber: 42, checksPassed: 2, version: 1 })
    allowRepos(['compai/app'])
    const { signals } = signalRig()

    const stream = open({ subscribed: [subscribedState(7)], signals })

    await waitFor(() => expect(stream.states()).toHaveLength(2))
    expect(stream.seen[0]).toEqual({ type: EGithubPrStatesFrame.Heartbeat })
    expect(stream.states().map((state) => `${state.repoFullName}#${state.prNumber}`)).toEqual([
      'compai/other#7',
      'compai/app#42',
    ])
  })

  it('receives a live linked state pushed with no subscriber userIds', async () => {
    await seedLinkedPr({ userId: OWNER, threadId: 'thr_1' })
    await seedPrState({ prNumber: 42, checksPassed: 2, version: 1 })
    allowRepos(['compai/app'])
    const { signals } = signalRig()
    const stream = open({ signals })
    await waitFor(() => expect(stream.states()).toHaveLength(1))

    stream.fanout.push({ userIds: [], state: { ...LINKED, version: 2, checksPassed: 5 } })

    await waitFor(() => expect(stream.states()).toHaveLength(2))
    expect(stream.states()[1]?.checksPassed).toBe(5)
  })

  it('never sends a PR whose repo github denies', async () => {
    await seedLinkedPr({ userId: OWNER, threadId: 'thr_1', number: 42 })
    await seedLinkedPr({ userId: OWNER, threadId: 'thr_1', number: 43, repo: 'compai/private' })
    await seedPrState({ prNumber: 42, checksPassed: 2, version: 1 })
    await seedPrState({
      repoFullName: 'compai/private',
      prNumber: 43,
      checksPassed: 2,
      version: 1,
    })
    allowRepos(['compai/app'])
    const { signals } = signalRig()
    const stream = open({ signals })

    await waitFor(() => expect(stream.states()).toHaveLength(1))
    stream.fanout.push({ userIds: [], state: { ...LINKED, prNumber: 43, version: 2 } })
    stream.fanout.push({
      userIds: [],
      state: { ...LINKED, repoFullName: 'compai/private', prNumber: 43, version: 2 },
    })

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(stream.states().map((state) => `${state.repoFullName}#${state.prNumber}`)).toEqual([
      'compai/app#42',
    ])
  })

  it('adds a PR a thread-change signal names, without re-reading the thread links', async () => {
    await seedLinkedPr({ userId: OWNER, threadId: 'thr_1' })
    await seedPrState({ prNumber: 42, checksPassed: 2, version: 1 })
    await seedPrState({ prNumber: 50, checksPassed: 4, version: 1 })
    allowRepos(['compai/app'])
    const { signals, state, signalFor } = signalRig()
    const stream = open({ signals })
    await waitFor(() => expect(stream.states()).toHaveLength(1))

    state.listener?.(signalFor([{ repo: 'github.com/CompAI/App', number: 50 }]))

    await waitFor(() => expect(stream.states()).toHaveLength(2))
    expect(stream.states()[1]).toMatchObject({ prNumber: 50, checksPassed: 4 })
    stream.fanout.push({ userIds: [], state: { ...LINKED, prNumber: 50, version: 2 } })
    await waitFor(() => expect(stream.states()).toHaveLength(3))
  })

  it('stops delivering once detached', async () => {
    await seedLinkedPr({ userId: OWNER, threadId: 'thr_1' })
    await seedPrState({ prNumber: 42, checksPassed: 2, version: 1 })
    allowRepos(['compai/app'])
    const { signals } = signalRig()
    const stream = open({ signals })
    await waitFor(() => expect(stream.states()).toHaveLength(1))

    stream.detach()
    stream.fanout.push({ userIds: [OWNER], state: { ...LINKED, version: 2 } })

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(stream.states()).toHaveLength(1)
  })

  it('sets no access recheck interval, only the heartbeat', async () => {
    await seedLinkedPr({ userId: OWNER, threadId: 'thr_1' })
    await seedPrState({ prNumber: 42, checksPassed: 2, version: 1 })
    const calls = allowRepos(['compai/app'])
    const intervals: number[] = []
    const realSetInterval = globalThis.setInterval
    const spy = vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      handler: Parameters<typeof setInterval>[0],
      delay?: number,
    ) => {
      intervals.push(delay ?? 0)
      return realSetInterval(handler, delay)
    }) as typeof setInterval)
    const { signals } = signalRig()
    const stream = open({ signals })
    await waitFor(() => expect(stream.states()).toHaveLength(1))

    expect(intervals).toEqual([PR_STATES_HEARTBEAT_MS])
    expect(calls.every((call) => call.includes('/repos/'))).toBe(true)
    spy.mockRestore()
  })

  it('makes no access call when a later stream connect finds the repo granted', async () => {
    await seedLinkedPr({ userId: OWNER, threadId: 'thr_1' })
    await seedPrState({ prNumber: 42, checksPassed: 2, version: 1 })
    const calls = allowRepos(['compai/app'])
    const github = githubOf()
    const access = new LinkedPrAccess({ coordinator: localCoordinator(github), github })
    const { signals } = signalRig()

    const first = open({ signals, access })
    await waitFor(() => expect(first.states()).toHaveLength(1))
    expect(calls).toHaveLength(1)
    first.detach()

    setSystemTime(new Date(Date.now() + 365 * 24 * 3_600_000))
    const second = open({ signals, access })
    await waitFor(() => expect(second.states()).toHaveLength(1))
    expect(calls).toHaveLength(1)
  })
})
