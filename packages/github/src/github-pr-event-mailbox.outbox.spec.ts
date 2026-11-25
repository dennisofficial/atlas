import { db } from '@dltech/atlas-db'
import { RecordingDrain } from './testing/drain.fixture'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { ensureUsers, prEventRows, seedSubscription } from './testing/github-seed'
import { inertMergeabilityRefresh, inertReconcile } from './github-pr-store.fixture'
import { GithubPrDiscussionDeliveryService } from './github-pr-discussion-delivery.service'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { GithubPrOutboxDispatcher } from './github-pr-outbox'
import { EPrEventKind } from './github-realtime.types'

function rig(): {
  fanout: GithubPrFanoutService
  dispatcher: GithubPrOutboxDispatcher
  mailbox: GithubPrEventMailboxService
} {
  const fanout = new GithubPrFanoutService(new RecordingDrain())
  const dispatcher = new GithubPrOutboxDispatcher({
    fanout,
    reconcile: inertReconcile(),
    mergeability: inertMergeabilityRefresh(),
  })
  return {
    fanout,
    dispatcher,
    mailbox: new GithubPrEventMailboxService(fanout, dispatcher),
  }
}

const ISSUE_COMMENT = {
  action: 'created',
  issue: {
    number: 42,
    html_url: 'https://github.com/compai/app/pull/42',
    pull_request: { html_url: 'https://github.com/compai/app/pull/42' },
  },
  comment: {
    id: 901,
    body: 'hi',
    html_url: 'https://github.com/compai/app/pull/42#issuecomment-901',
    user: { login: 'dennis' },
  },
  sender: { login: 'dennis' },
  repository: { full_name: 'compai/app' },
}

const outboxRows = () => db.orm.public.GithubPrOutbox.all()

describe('GithubPrEventMailboxService outbox', () => {
  useTestDatabase()

  beforeEach(async () => {
    await ensureUsers('usr-a', 'usr-b')
  })

  it('a committed discussion delivery writes its outbox rows and notifies once after the commit', async () => {
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    const { mailbox } = rig()
    const discussion = new GithubPrDiscussionDeliveryService(mailbox)

    await discussion.handleIssueComment(ISSUE_COMMENT)

    expect(await prEventRows()).toHaveLength(1)
    const rows = await outboxRows()
    expect(rows.map((row) => row.kind).sort()).toEqual(['fanout', 'v2-notice'])
    expect(rows.every((row) => row.dispatchedAt !== null)).toBe(true)
    expect(rows.every((row) => row.attempts === 0)).toBe(true)
  })

  it('a record whose transaction rolls back leaves no event row and no outbox row', async () => {
    const { mailbox } = rig()

    await expect(
      mailbox.record({
        userIds: ['usr-a', 'usr-missing'],
        repoFullName: 'compai/app',
        prNumber: 42,
        kind: EPrEventKind.Comment,
        payload: {
          url: 'https://github.com/compai/app/pull/42#issuecomment-1',
          authorLogin: 'dennis',
          body: 'hi',
        },
      }),
    ).rejects.toThrow()

    expect(await prEventRows()).toHaveLength(0)
    expect(await outboxRows()).toHaveLength(0)
  })

  it('a dispatch that throws after commit leaves the rows pending and the drain delivers them once', async () => {
    const { fanout } = rig()
    const offline = {
      dispatch: async () => {
        throw new Error('dispatch down')
      },
    } as unknown as GithubPrOutboxDispatcher
    const mailbox = new GithubPrEventMailboxService(fanout, offline)

    await expect(
      mailbox.record({
        userIds: ['usr-a'],
        repoFullName: 'compai/app',
        prNumber: 42,
        kind: EPrEventKind.Verdict,
        payload: { url: 'https://github.com/compai/app/pull/42', verdict: 'green', headSha: 'abc' },
      }),
    ).rejects.toThrow('dispatch down')

    expect(await prEventRows()).toHaveLength(1)
    expect(await outboxRows()).toHaveLength(2)
    expect((await outboxRows()).every((row) => row.dispatchedAt === null)).toBe(true)

    const dispatcher = new GithubPrOutboxDispatcher({
      fanout,
      reconcile: inertReconcile(),
      mergeability: inertMergeabilityRefresh(),
    })
    expect(await dispatcher.drain()).toBe(2)
    expect(await dispatcher.drain()).toBe(0)
    expect((await outboxRows()).every((row) => row.dispatchedAt !== null)).toBe(true)
  })
})
