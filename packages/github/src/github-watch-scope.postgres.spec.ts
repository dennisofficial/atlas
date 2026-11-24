import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'

import { inWatchScope } from './github-watch-scope'
import { ensureUsers, seedPrState, seedSubscription } from './testing/github-seed'

const REPO = 'compai/app'
const LIVE = new Date(Date.now() + 60 * 60 * 1_000)
const LAPSED = new Date(Date.now() - 60 * 60 * 1_000)

const seedTarget = (args: {
  branch?: string
  kind: 'head' | 'pull-request'
  liveUntil?: Date
  prNumber?: number
  repoFullName?: string
  userId?: string
}) =>
  db.orm.public.GithubTrackingTarget.create({
    userId: args.userId ?? 'usr_1',
    kind: args.kind,
    repoFullName: args.repoFullName ?? REPO,
    branch: args.branch ?? '',
    prNumber: args.prNumber ?? 0,
    liveUntil: args.liveUntil ?? LIVE,
  })

const seedSession = async (id: string): Promise<void> => {
  await ensureUsers('usr_1')
  await db.orm.v2.V2Session.create({
    id,
    userId: 'usr_1',
    mainThreadId: `thr_${id}`,
    nextInboxId: 1,
    createdAt: new Date(),
    modelRef: 'anthropic/claude-haiku-4-5',
    modelEffort: 'medium',
    modelFast: false,
  })
}

describe('inWatchScope', () => {
  useTestDatabase()

  beforeEach(async () => {
    await ensureUsers('usr_1')
  })

  it('answers true for a live subscription on the pull request', async () => {
    await seedSubscription({ prNumber: 42, liveUntil: LIVE })

    expect(await inWatchScope({ repoFullName: REPO, prNumbers: [42] })).toBe(true)
  })

  it('answers true for a live subscription on the head branch', async () => {
    await seedSubscription({ prNumber: null, branch: 'dennis/add-the-thing', liveUntil: LIVE })

    expect(
      await inWatchScope({
        repoFullName: REPO,
        heads: [{ repoFullName: REPO, branch: 'dennis/add-the-thing' }],
      }),
    ).toBe(true)
  })

  it('answers true for a live tracking target on the pull request', async () => {
    await seedTarget({ kind: 'pull-request', prNumber: 42, liveUntil: LIVE })

    expect(await inWatchScope({ repoFullName: REPO, prNumbers: [42] })).toBe(true)
  })

  it('answers true for a live tracking target on the head branch', async () => {
    await seedTarget({ kind: 'head', branch: 'dennis/add-the-thing', liveUntil: LIVE })

    expect(
      await inWatchScope({
        repoFullName: REPO,
        heads: [{ repoFullName: REPO, branch: 'dennis/add-the-thing' }],
      }),
    ).toBe(true)
  })

  it('answers true for a sha that belongs to a watched pull request', async () => {
    await seedPrState({ headSha: 'sha-watched', prNumber: 42 })
    await seedSubscription({ prNumber: 42, liveUntil: LIVE })

    expect(await inWatchScope({ repoFullName: REPO, headSha: 'sha-watched' })).toBe(true)
  })

  it('answers true for a session that still holds the pull request link', async () => {
    await seedSession('ses_pr')
    await db.orm.v2.V2SessionPullRequest.create({
      sessionId: 'ses_pr',
      repoFullName: REPO,
      prNumber: 42,
    })

    expect(await inWatchScope({ repoFullName: REPO, prNumbers: [42] })).toBe(true)
  })

  it('answers true for a session that still holds the branch link', async () => {
    await seedSession('ses_branch')
    await db.orm.v2.V2SessionBranch.create({
      sessionId: 'ses_branch',
      headRepo: REPO,
      branch: 'dennis/add-the-thing',
      firstSeenSeq: 1,
    })

    expect(
      await inWatchScope({
        repoFullName: REPO,
        heads: [{ repoFullName: REPO, branch: 'dennis/add-the-thing' }],
      }),
    ).toBe(true)
  })

  it('answers false once every subscription and target on the key has lapsed', async () => {
    await seedSubscription({ prNumber: 42, liveUntil: LAPSED })
    await seedTarget({ kind: 'pull-request', prNumber: 42, liveUntil: LAPSED })

    expect(await inWatchScope({ repoFullName: REPO, prNumbers: [42] })).toBe(false)
  })

  it('answers false for a delivery that keys on nothing watched', async () => {
    await seedSubscription({ prNumber: 42, liveUntil: LIVE })
    await seedTarget({ kind: 'head', branch: 'dennis/add-the-thing', liveUntil: LIVE })

    expect(await inWatchScope({ repoFullName: REPO, prNumbers: [7] })).toBe(false)
    expect(
      await inWatchScope({ repoFullName: REPO, heads: [{ repoFullName: REPO, branch: 'other' }] }),
    ).toBe(false)
    expect(await inWatchScope({ repoFullName: 'compai/other', prNumbers: [42] })).toBe(false)
  })

  it('answers true for a delivery it cannot key on anything', async () => {
    expect(await inWatchScope({ repoFullName: REPO })).toBe(true)
  })
})
