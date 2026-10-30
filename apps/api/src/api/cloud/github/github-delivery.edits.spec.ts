import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { prEventRows } from '../../../../test/github-seed'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { prepareDelivery, PULL_REQUEST_PAYLOAD, seedSubscription } from './github-delivery.fixture'
import { GithubPrDiscussionDeliveryService } from './github-pr-discussion-delivery.service'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import type { GithubSandboxWakeService } from './github-sandbox-wake.service'

function discussionWith(): {
  discussion: GithubPrDiscussionDeliveryService
  wakes: unknown[]
} {
  const wakes: unknown[] = []
  const wake = {
    notifyEvent: (args: unknown) => wakes.push(args),
  } as unknown as GithubSandboxWakeService
  const mailbox = new GithubPrEventMailboxService(
    new GithubPrFanoutService(new DrainStateService()),
    wake,
  )
  return { discussion: new GithubPrDiscussionDeliveryService(mailbox), wakes }
}

const REPOSITORY = { full_name: 'compai/app' }
const ISSUE = {
  number: 42,
  html_url: 'https://github.com/compai/app/pull/42',
  pull_request: { html_url: 'https://github.com/compai/app/pull/42' },
}

function issueComment(args: {
  action: string
  body: string
  changes?: { body?: { from: string } }
  user?: { login: string } | null
}) {
  return {
    action: args.action,
    issue: ISSUE,
    comment: {
      id: 901,
      body: args.body,
      html_url: 'https://github.com/compai/app/pull/42#issuecomment-901',
      user: args.user === undefined ? { login: 'vercel[bot]' } : args.user,
    },
    ...(args.changes === undefined ? {} : { changes: args.changes }),
    sender: { login: 'dennis' },
    repository: REPOSITORY,
  }
}

describe('GithubPrDiscussionDeliveryService edited comments', () => {
  useTestDatabase()

  beforeEach(async () => {
    await prepareDelivery()
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
  })

  it('records an edited issue_comment with edited, commentId, excerpt and the comment author', async () => {
    const { discussion } = discussionWith()

    await discussion.handleIssueComment(
      issueComment({
        action: 'edited',
        body: 'a\nready',
        changes: { body: { from: 'a\nbuilding' } },
      }),
    )

    expect(await prEventRows()).toHaveLength(1)
    expect((await prEventRows())[0]).toMatchObject({
      kind: 'comment',
      payload: {
        url: 'https://github.com/compai/app/pull/42#issuecomment-901',
        authorLogin: 'vercel[bot]',
        body: 'ready',
        commentId: '901',
        edited: true,
      },
    })
  })

  it('falls back to the sender when an edited comment has no user', async () => {
    const { discussion } = discussionWith()

    await discussion.handleIssueComment(
      issueComment({
        action: 'edited',
        body: 'b',
        changes: { body: { from: 'a' } },
        user: null,
      }),
    )

    expect((await prEventRows())[0]).toMatchObject({ payload: { authorLogin: 'dennis' } })
  })

  it('ignores an edit that did not change the body', async () => {
    const { discussion } = discussionWith()

    await discussion.handleIssueComment(issueComment({ action: 'edited', body: 'x', changes: {} }))
    await discussion.handleIssueComment(issueComment({ action: 'edited', body: 'x' }))

    expect(await prEventRows()).toHaveLength(0)
  })

  it('records an edited review comment with the head sha', async () => {
    const { discussion } = discussionWith()

    await discussion.handleReviewComment({
      action: 'edited',
      pull_request: PULL_REQUEST_PAYLOAD.pull_request,
      comment: {
        id: 77,
        body: 'nit: rename\nand move',
        html_url: 'https://github.com/compai/app/pull/42#discussion_r77',
        user: { login: 'reviewer' },
      },
      changes: { body: { from: 'nit: rename' } },
      sender: { login: 'dennis' },
      repository: REPOSITORY,
    })

    expect((await prEventRows())[0]).toMatchObject({
      kind: 'review-comment',
      payload: {
        authorLogin: 'reviewer',
        body: 'and move',
        commentId: '77',
        edited: true,
        headSha: 'abc123',
      },
    })
  })

  it('edits never wake a sandbox, created comments do', async () => {
    const { discussion, wakes } = discussionWith()

    await discussion.handleIssueComment(
      issueComment({
        action: 'edited',
        body: 'b',
        changes: { body: { from: 'a' } },
      }),
    )
    expect(wakes).toHaveLength(0)

    await discussion.handleIssueComment(issueComment({ action: 'created', body: 'hi' }))
    expect(wakes).toHaveLength(1)
  })

  it('a created comment carries its commentId and the sender as author', async () => {
    const { discussion } = discussionWith()

    await discussion.handleIssueComment(issueComment({ action: 'created', body: 'hi' }))

    const payload = (await prEventRows())[0]?.payload as Record<string, unknown>
    expect(payload).toMatchObject({ commentId: '901', authorLogin: 'dennis' })
    expect(payload.edited).toBeUndefined()
  })
})
