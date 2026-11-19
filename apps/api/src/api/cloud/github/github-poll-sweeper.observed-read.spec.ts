import type { MergeabilitySample } from '@dltech/atlas-core'
import { EPrSource } from '@dltech/atlas-core'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { prStateRows } from '../../../../test/github-seed'
import { DrainStateService } from '../../platform/health/drain-state.service'
import type { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import { GithubHeadReads } from './github-head-reads'
import { preparePollSweeper, seedSubscription } from './github-poll-sweeper.fixture'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { GithubPollSweeperService } from './github-poll-sweeper.service'
import { storeFixture } from './github-pr-store.fixture'
import { mergeabilityObservationOfSample, pullObservationOfRest } from './github-pr-observations'
import { applyObservedPull } from './github-pr-observed-pull'
import { localCoordinator } from './github-request-coordinator.fixture'
import { GithubSubscribeStateWriter } from './github-subscribe-state-writer'
import { GithubSubscribedPrResolver } from './github-subscribed-pr-resolver'
import { GithubUserReads } from './github-user-reads'
import type { GithubService } from './github.service'

const SHA = 'abc123'
const TOKEN = 'ghu_1'
const REPO = 'compai/app'

type PullAnswer = {
  number: number
  title: string
  updated_at: string
  mergeable: boolean | null
  mergeable_state: string
}

const pullJson = (args: PullAnswer) => ({
  number: args.number,
  title: args.title,
  html_url: `https://github.com/${REPO}/pull/${args.number}`,
  state: 'open',
  draft: false,
  merged_at: null,
  updated_at: args.updated_at,
  mergeable: args.mergeable,
  mergeable_state: args.mergeable_state,
  head: { ref: 'dennis/add-the-thing', sha: SHA, repo: { full_name: REPO } },
  base: { ref: 'main' },
})

const pullAnswerOf = (mergeable: boolean): PullAnswer => ({
  number: 42,
  title: 'add the thing',
  updated_at: '2026-11-18T00:00:00Z',
  mergeable,
  mergeable_state: mergeable ? 'clean' : 'blocked',
})

const checkRunOf = (args: { status: string; conclusion: string | null }) => ({
  check_runs: [
    {
      id: 7,
      name: 'build',
      started_at: '2026-11-18T00:00:00Z',
      status: args.status,
      conclusion: args.conclusion,
      completed_at: args.status === 'completed' ? '2026-11-18T00:10:00Z' : null,
    },
  ],
})

type ChecksAnswer = { status: string; conclusion: string | null }

function gateOf(): {
  wait: Promise<void>
  open: () => void
  began: Promise<void>
  start: () => void
} {
  let open: () => void = () => undefined
  let start: () => void = () => undefined
  const wait = new Promise<void>((resolve) => {
    open = resolve
  })
  const began = new Promise<void>((resolve) => {
    start = resolve
  })

  return { wait, open, began, start: () => start() }
}

describe('GithubPollSweeperService over a real read', () => {
  useTestDatabase()
  beforeEach(preparePollSweeper)
  afterEach(() => {
    restore?.()
    restore = undefined
  })

  let restore: (() => void) | undefined

  const mockGithub = (args: {
    pull?: () => PullAnswer
    checks?: () => ChecksAnswer
    gate?: ReturnType<typeof gateOf>
  }): string[] => {
    const paths: string[] = []
    const mock = spyOn(globalThis, 'fetch').mockImplementation((async (input: URL | string) => {
      const path = new URL(String(input)).pathname
      paths.push(path)
      if (path.endsWith('/check-runs')) {
        args.gate?.start()
        await args.gate?.wait
        return Response.json(
          checkRunOf(args.checks?.() ?? { status: 'completed', conclusion: 'success' }),
        )
      }
      if (path.endsWith('/status')) return Response.json({ statuses: [] })
      if (path.includes('/rules/branches/'))
        return Response.json([
          {
            type: 'required_status_checks',
            parameters: { required_status_checks: [{ context: 'ci/build' }] },
          },
        ])
      if (path.includes('/branches/')) return Response.json({ contexts: [] })
      if (path.includes('/pulls')) return Response.json(pullJson((args.pull ?? defaultPull)()))
      return Response.json({ full_name: REPO, private: true })
    }) as unknown as typeof fetch)
    restore = () => mock.mockRestore()

    return paths
  }

  const defaultPull = () => pullAnswerOf(true)

  const fanoutOf = () => new GithubPrFanoutService(new DrainStateService())

  const serviceOf = (): GithubPollSweeperService => {
    const github = { findToken: async () => TOKEN } as unknown as GithubService

    return new GithubPollSweeperService(
      github,
      new GithubUserReads(),
      { ensureHook: async () => 'poll-backed' } as unknown as GithubHookLifecycleService,
      localCoordinator(github),
      new GithubHeadReads(),
      storeFixture({ fanout: fanoutOf() }),
    )
  }

  it('records the checks a poll reads and follows GitHub from running to failed', async () => {
    let checks: ChecksAnswer = { status: 'in_progress', conclusion: null }
    mockGithub({ checks: () => checks })
    await seedSubscription({ pollBacked: true })
    const service = serviceOf()

    await service.handlePoll()

    const [running] = await prStateRows()
    expect(running).toMatchObject({ prNumber: 42, checksRunning: 1, checksFailed: 0 })
    const ledger = await db.orm.public.GithubCommitCheck.where({ headSha: SHA }).all()
    expect(ledger).toHaveLength(1)

    checks = { status: 'completed', conclusion: 'failure' }
    await db.orm.public.GithubTrackingTarget.where({ prNumber: 42 }).update({
      lookedUpAt: null,
      leaseUntil: null,
      nextDueAt: new Date(Date.now() - 1_000),
    })
    await service.handlePoll()

    const [failed] = await prStateRows()
    expect(failed).toMatchObject({ checksRunning: 0, checksFailed: 1, checksPassed: 0 })
  })

  it('keeps a newer mergeability sample when an older read lands after it', async () => {
    const gate = gateOf()
    mockGithub({ pull: () => pullAnswerOf(false), gate })
    await seedSubscription({ pollBacked: true })
    const store = storeFixture({ fanout: fanoutOf() })
    const github = { findToken: async () => TOKEN } as unknown as GithubService
    const service = new GithubPollSweeperService(
      github,
      new GithubUserReads(),
      { ensureHook: async () => 'poll-backed' } as unknown as GithubHookLifecycleService,
      localCoordinator(github),
      new GithubHeadReads(),
      store,
    )

    const polled = service.handlePoll()
    await gate.began
    const newer: MergeabilitySample = {
      headSha: SHA,
      baseBranch: 'main',
      mergeable: true,
      mergeClean: true,
      observedAt: new Date().toISOString(),
    }
    const newerPull = pullJson(pullAnswerOf(true))
    const newerObservation = pullObservationOfRest({
      repoFullName: REPO,
      pull: newerPull,
      updatedAt: newerPull.updated_at,
      observedAt: newer.observedAt,
      source: EPrSource.SubscribePull,
    })
    if (newerObservation === null) throw new Error('the newer pull sample is incomplete')
    await applyObservedPull({
      store,
      repoFullName: REPO,
      prNumber: 42,
      observations: [
        newerObservation,
        mergeabilityObservationOfSample({ sample: newer, source: EPrSource.SubscribePull }),
      ],
      headSha: SHA,
      checks: [],
      protection: { acquiredAt: new Date(), baseBranch: 'main', requiredContexts: [] },
    })
    gate.open()
    await polled

    const [row] = await prStateRows()
    expect(row).toMatchObject({ mergeable: true, mergeClean: true })
    expect(row?.mergeableObservedAt?.toISOString()).toBe(newer.observedAt)
  })

  it('seeds the checks and required contexts a subscribe reads', async () => {
    mockGithub({})
    const coordinator = localCoordinator()
    const store = storeFixture({ fanout: fanoutOf() })
    const writer = new GithubSubscribeStateWriter({
      prs: new GithubSubscribedPrResolver({ reads: new GithubUserReads(), coordinator }),
      store,
    })

    const state = await writer.pullOnSubscribe({
      userId: 'usr_1',
      token: TOKEN,
      owner: 'compai',
      repo: 'app',
      repoFullName: REPO,
      prNumber: 42,
      covered: false,
    })

    expect(state).toMatchObject({ prNumber: 42, checksPassed: 1, checksFailed: 0 })
    const protection = await db.orm.public.GithubBranchProtection.where({
      repoFullName: REPO,
      baseBranch: 'main',
    }).first()
    expect(protection?.requiredContexts).toEqual(['ci/build'])
  })
})
