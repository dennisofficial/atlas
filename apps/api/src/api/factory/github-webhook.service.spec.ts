import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../generated/prisma/client'

vi.mock('../../db', async () => {
  const { fakeFactoryDb } = await import('../../../test/fake-factory-db.js')
  return { db: fakeFactoryDb().db as unknown as PrismaClient }
})

import { fakeFactoryDb } from '../../../test/fake-factory-db.js'
import { FactoryConnectionsService } from './connections/connections.service'
import type { FactoryDrivesService } from './drives/drives.service'
import { DEFAULT_ORGANIZATION_ID, EFactoryEventKind, EFactoryWorkItemStatus } from './factory.types'
import { GithubWebhookService } from './github-webhook.service'
import type { OrchestratorService } from './orchestrator/orchestrator.service'
import type { GithubAppService } from './reply/github-app.service'
import type { StationsService } from './stations/stations.service'
import { TranscriptService } from './transcript.service'
import { WorkItemsService } from './work-items.service'

const REPO = 'compai/atlas'

function issuesLabeledPayload(): unknown {
  return {
    action: 'labeled',
    issue: { number: 341 },
    label: { name: 'atlas-factory' },
    repository: { full_name: REPO },
    sender: { login: 'dennislysenko' },
  }
}

function issueCommentPayload(overrides: { authorAssociation?: string; body?: string } = {}): unknown {
  return {
    action: 'created',
    issue: { number: 341 },
    comment: {
      id: 9001,
      author_association: overrides.authorAssociation ?? 'OWNER',
      body: overrides.body ?? 'taking a look at this',
    },
    repository: { full_name: REPO },
    sender: { login: 'dennislysenko' },
  }
}

function pullRequestMergedPayload(): unknown {
  return {
    action: 'closed',
    pull_request: { number: 87, merged: true },
    repository: { full_name: REPO },
    sender: { login: 'dennislysenko' },
  }
}

describe('GithubWebhookService', () => {
  const fake = fakeFactoryDb()
  let service: GithubWebhookService
  let workItems: WorkItemsService
  let orchestrator: { wake: ReturnType<typeof vi.fn> }
  let githubApp: {
    botLogin: ReturnType<typeof vi.fn>
    ownsAppId: ReturnType<typeof vi.fn>
    addIssueReaction: ReturnType<typeof vi.fn>
    addCommentReaction: ReturnType<typeof vi.fn>
    appSlug: ReturnType<typeof vi.fn>
  }
  let drives: { release: ReturnType<typeof vi.fn> }
  let stations: { stopRunningFor: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    fake.reset()
    workItems = new WorkItemsService()
    orchestrator = { wake: vi.fn() }
    githubApp = {
      botLogin: vi.fn(async () => 'atlas-factory[bot]'),
      ownsAppId: vi.fn((id: number | undefined) => id === 4275284),
      addIssueReaction: vi.fn(async () => undefined),
      addCommentReaction: vi.fn(async () => undefined),
      appSlug: vi.fn(async () => 'atlas-factory'),
    }
    drives = { release: vi.fn(async () => true) }
    stations = { stopRunningFor: vi.fn(async () => undefined) }
    service = new GithubWebhookService(
      workItems,
      new FactoryConnectionsService(),
      new TranscriptService(),
      orchestrator as unknown as OrchestratorService,
      githubApp as unknown as GithubAppService,
      drives as unknown as FactoryDrivesService,
      stations as unknown as StationsService,
    )
  })

  it('acknowledges ping without storing anything', async () => {
    const outcome = await service.handle({ event: 'ping', deliveryId: 'd-1', payload: {} })

    expect(outcome).toEqual({ handled: true })
    expect(fake.workItems).toHaveLength(0)
    expect(fake.transcriptEvents).toHaveLength(0)
  })

  it('an issue labeled atlas-factory creates a work item and an intake event', async () => {
    const outcome = await service.handle({
      event: 'issues',
      deliveryId: 'd-1',
      payload: issuesLabeledPayload(),
    })

    expect(outcome.handled).toBe(true)
    expect(outcome.kind).toBe(EFactoryEventKind.Intake)
    expect(fake.workItems).toHaveLength(1)
    expect(fake.aliases).toMatchObject([{ surface: 'github', externalId: `${REPO}#341` }])
    expect(fake.transcriptEvents).toMatchObject([{ kind: EFactoryEventKind.Intake, author: 'dennislysenko' }])
  })

  it('an intake labels the issue with an eyes reaction from the factory bot', async () => {
    const outcome = await service.handle({
      event: 'issues',
      deliveryId: 'd-1',
      payload: { ...(issuesLabeledPayload() as Record<string, unknown>), installation: { id: 42 } },
    })

    expect(outcome.kind).toBe(EFactoryEventKind.Intake)
    expect(githubApp.addIssueReaction).toHaveBeenCalledWith({
      installationId: 42,
      repoFullName: REPO,
      issueNumber: 341,
    })
  })

  it('a failed reaction never fails the intake it acknowledges', async () => {
    githubApp.addIssueReaction.mockRejectedValue(new Error('github unreachable'))

    const outcome = await service.handle({
      event: 'issues',
      deliveryId: 'd-1',
      payload: { ...(issuesLabeledPayload() as Record<string, unknown>), installation: { id: 42 } },
    })

    expect(outcome.handled).toBe(true)
    expect(outcome.kind).toBe(EFactoryEventKind.Intake)
    expect(fake.workItems).toHaveLength(1)
  })

  it('a payload without an installation id skips the reaction', async () => {
    await service.handle({ event: 'issues', deliveryId: 'd-1', payload: issuesLabeledPayload() })

    expect(githubApp.addIssueReaction).not.toHaveBeenCalled()
  })

  it('issue_comment appends a comment with author and lowercased association', async () => {
    await service.handle({ event: 'issues', deliveryId: 'd-1', payload: issuesLabeledPayload() })

    const outcome = await service.handle({
      event: 'issue_comment',
      deliveryId: 'd-2',
      payload: issueCommentPayload({ authorAssociation: 'MEMBER' }),
    })

    expect(outcome.handled).toBe(true)
    expect(outcome.kind).toBe(EFactoryEventKind.Comment)
    expect(fake.transcriptEvents).toMatchObject([
      { kind: EFactoryEventKind.Intake },
      { kind: EFactoryEventKind.Comment, author: 'dennislysenko', authorAssociation: 'member' },
    ])
  })

  it('a comment accepted onto a tracked issue gets the ack reaction', async () => {
    await service.handle({ event: 'issues', deliveryId: 'd-1', payload: issuesLabeledPayload() })

    const outcome = await service.handle({
      event: 'issue_comment',
      deliveryId: 'd-2',
      payload: { ...(issueCommentPayload() as Record<string, unknown>), installation: { id: 42 } },
    })

    expect(outcome).toMatchObject({ handled: true, appended: true })
    expect(githubApp.addCommentReaction).toHaveBeenCalledWith({
      installationId: 42,
      repoFullName: REPO,
      commentId: 9001,
    })
  })

  it("drops the factory's own comment echo instead of waking the orchestrator with it", async () => {
    await service.handle({ event: 'issues', deliveryId: 'd-1', payload: issuesLabeledPayload() })
    orchestrator.wake.mockClear()

    const echo = issueCommentPayload() as { sender: { login: string } }
    echo.sender.login = 'Atlas-Factory[bot]'
    const outcome = await service.handle({ event: 'issue_comment', deliveryId: 'd-echo', payload: echo })

    expect(outcome).toEqual({ handled: false })
    expect(fake.transcriptEvents).toHaveLength(1)
    expect(orchestrator.wake).not.toHaveBeenCalled()
  })

  it('drops the echo on the payload\'s own app id even when the bot-login lookup fails', async () => {
    githubApp.botLogin.mockRejectedValue(new Error('github unreachable'))
    await service.handle({ event: 'issues', deliveryId: 'd-1', payload: issuesLabeledPayload() })
    orchestrator.wake.mockClear()

    const echo = issueCommentPayload() as {
      comment: { performed_via_github_app?: { id: number; slug: string } }
    }
    echo.comment.performed_via_github_app = { id: 4275284, slug: 'atlas-by-dl' }
    const outcome = await service.handle({ event: 'issue_comment', deliveryId: 'd-echo', payload: echo })

    expect(outcome).toEqual({ handled: false })
    expect(fake.transcriptEvents).toHaveLength(1)
    expect(orchestrator.wake).not.toHaveBeenCalled()
  })

  it('a comment written through a different app is not the echo', async () => {
    await service.handle({ event: 'issues', deliveryId: 'd-1', payload: issuesLabeledPayload() })

    const comment = issueCommentPayload() as {
      comment: { performed_via_github_app?: { id: number; slug: string } }
    }
    comment.comment.performed_via_github_app = { id: 999, slug: 'dependabot' }
    const outcome = await service.handle({ event: 'issue_comment', deliveryId: 'd-2', payload: comment })

    expect(outcome.handled).toBe(true)
    expect(fake.transcriptEvents).toHaveLength(2)
  })

  it('filters nothing when neither echo signal matches', async () => {
    githubApp.botLogin.mockResolvedValue(null)
    await service.handle({ event: 'issues', deliveryId: 'd-1', payload: issuesLabeledPayload() })

    const echo = issueCommentPayload() as { sender: { login: string } }
    echo.sender.login = 'atlas-factory[bot]'
    const outcome = await service.handle({ event: 'issue_comment', deliveryId: 'd-echo', payload: echo })

    expect(outcome.handled).toBe(true)
    expect(fake.transcriptEvents).toHaveLength(2)
  })

  it('the same delivery id redelivered appends only once and acks only once', async () => {
    await service.handle({ event: 'issues', deliveryId: 'd-1', payload: issuesLabeledPayload() })
    const payload = { ...(issueCommentPayload() as Record<string, unknown>), installation: { id: 42 } }

    await service.handle({ event: 'issue_comment', deliveryId: 'd-2', payload })
    await service.handle({ event: 'issue_comment', deliveryId: 'd-2', payload })

    expect(fake.transcriptEvents.filter((one) => one.deliveryId === 'd-2')).toHaveLength(1)
    expect(githubApp.addCommentReaction).toHaveBeenCalledTimes(1)
  })

  it('a comment on an untracked issue is not handled and nothing is stored', async () => {
    const outcome = await service.handle({
      event: 'issue_comment',
      deliveryId: 'd-1',
      payload: issueCommentPayload(),
    })

    expect(outcome).toEqual({ handled: false })
    expect(fake.workItems).toHaveLength(0)
    expect(fake.transcriptEvents).toHaveLength(0)
    expect(githubApp.addIssueReaction).not.toHaveBeenCalled()
  })

  it('a comment mentioning the bot on an untracked issue intakes a work item', async () => {
    const payload = {
      ...(issueCommentPayload({ body: '@Atlas-Factory[bot] can you take this?' }) as Record<string, unknown>),
      installation: { id: 42 },
    }

    const outcome = await service.handle({ event: 'issue_comment', deliveryId: 'd-mention', payload })

    expect(outcome).toMatchObject({ handled: true, kind: EFactoryEventKind.Intake, appended: true })
    expect(fake.workItems).toHaveLength(1)
    expect(fake.aliases).toMatchObject([{ surface: 'github', externalId: `${REPO}#341`, kind: 'issue' }])
    expect(fake.transcriptEvents).toMatchObject([
      { kind: EFactoryEventKind.Intake, author: 'dennislysenko', authorAssociation: 'owner' },
    ])
    expect(githubApp.addCommentReaction).toHaveBeenCalledWith({
      installationId: 42,
      repoFullName: REPO,
      commentId: 9001,
    })
    expect(orchestrator.wake).toHaveBeenCalledTimes(1)
    expect(orchestrator.wake).toHaveBeenCalledWith({ workItemId: outcome.workItemId, externalId: `${REPO}#341` })
  })

  it('a mention on an untracked pull request intakes with the pull-request alias', async () => {
    const outcome = await service.handle({
      event: 'issue_comment',
      deliveryId: 'd-mention',
      payload: {
        action: 'created',
        issue: { number: 87, pull_request: { url: `https://api.github.com/repos/${REPO}/pulls/87` } },
        comment: { id: 9002, author_association: 'MEMBER', body: '@atlas-factory[bot] pick this up' },
        repository: { full_name: REPO },
        sender: { login: 'tofik' },
        installation: { id: 42 },
      },
    })

    expect(outcome).toMatchObject({ handled: true, kind: EFactoryEventKind.Intake, appended: true })
    expect(fake.aliases).toMatchObject([{ surface: 'github', externalId: `${REPO}/pull/87`, kind: 'pull-request' }])
    expect(githubApp.addCommentReaction).toHaveBeenCalledWith({
      installationId: 42,
      repoFullName: REPO,
      commentId: 9002,
    })
    expect(orchestrator.wake).toHaveBeenCalledWith({
      workItemId: outcome.workItemId,
      externalId: `${REPO}/pull/87`,
    })
  })

  it('a mention on an already-tracked issue stays a plain comment event', async () => {
    await service.handle({ event: 'issues', deliveryId: 'd-1', payload: issuesLabeledPayload() })
    orchestrator.wake.mockClear()

    const outcome = await service.handle({
      event: 'issue_comment',
      deliveryId: 'd-2',
      payload: issueCommentPayload({ body: '@atlas-factory[bot] status?' }),
    })

    expect(outcome.kind).toBe(EFactoryEventKind.Comment)
    expect(fake.workItems).toHaveLength(1)
    expect(fake.transcriptEvents).toMatchObject([
      { kind: EFactoryEventKind.Intake },
      { kind: EFactoryEventKind.Comment },
    ])
    expect(githubApp.addCommentReaction).not.toHaveBeenCalled()
    expect(orchestrator.wake).toHaveBeenCalledTimes(1)
  })

  it('a bare @slug mention (how humans type it) intakes on an untracked issue', async () => {
    const payload = {
      ...(issueCommentPayload({ body: '@atlas-factory fix ci on this branch' }) as Record<string, unknown>),
      installation: { id: 42 },
    }

    const outcome = await service.handle({ event: 'issue_comment', deliveryId: 'd-bare', payload })

    expect(outcome).toMatchObject({ handled: true, kind: EFactoryEventKind.Intake, appended: true })
    expect(fake.workItems).toHaveLength(1)
    expect(githubApp.addCommentReaction).toHaveBeenCalled()
  })

  it('a longer login that merely starts with the slug is not a mention', async () => {
    const outcome = await service.handle({
      event: 'issue_comment',
      deliveryId: 'd-1',
      payload: issueCommentPayload({ body: '@atlas-factoryish please look' }),
    })

    expect(outcome).toEqual({ handled: false })
    expect(fake.workItems).toHaveLength(0)
  })

  it('a mention-shaped comment on an untracked issue drops when the app slug is unresolvable', async () => {
    githubApp.appSlug.mockRejectedValue(new Error('github unreachable'))

    const outcome = await service.handle({
      event: 'issue_comment',
      deliveryId: 'd-1',
      payload: issueCommentPayload({ body: '@atlas-factory[bot] hello' }),
    })

    expect(outcome).toEqual({ handled: false })
    expect(fake.workItems).toHaveLength(0)
    expect(fake.transcriptEvents).toHaveLength(0)
    expect(githubApp.addCommentReaction).not.toHaveBeenCalled()
    expect(orchestrator.wake).not.toHaveBeenCalled()
  })

  it('issue_comment on a pull request routes to the pull-request alias, not an issue alias', async () => {
    const { workItem } = await workItems.intake({
      organizationId: DEFAULT_ORGANIZATION_ID,
      repo: REPO,
      sourceKind: 'github',
      surface: 'github',
      externalId: `${REPO}/pull/87`,
      aliasKind: 'pull-request',
    })

    const outcome = await service.handle({
      event: 'issue_comment',
      deliveryId: 'd-2',
      payload: {
        action: 'created',
        issue: { number: 87, pull_request: { url: `https://api.github.com/repos/${REPO}/pulls/87` } },
        comment: { author_association: 'MEMBER' },
        repository: { full_name: REPO },
        sender: { login: 'tofik' },
      },
    })

    expect(outcome).toMatchObject({
      handled: true,
      workItemId: workItem.id,
      kind: EFactoryEventKind.Comment,
      appended: true,
    })
    expect(fake.transcriptEvents).toMatchObject([{ kind: EFactoryEventKind.Comment, author: 'tofik' }])
  })

  it('a redelivered merge does not re-transition the work item', async () => {
    const { workItem } = await workItems.intake({
      organizationId: DEFAULT_ORGANIZATION_ID,
      repo: REPO,
      sourceKind: 'github',
      surface: 'github',
      externalId: `${REPO}/pull/87`,
      aliasKind: 'pull-request',
    })

    const first = await service.handle({
      event: 'pull_request',
      deliveryId: 'd-1',
      payload: pullRequestMergedPayload(),
    })
    const replay = await service.handle({
      event: 'pull_request',
      deliveryId: 'd-1',
      payload: pullRequestMergedPayload(),
    })

    expect(first.appended).toBe(true)
    expect(replay).toMatchObject({ handled: true, appended: false })
    expect(fake.transcriptEvents.filter((one) => one.deliveryId === 'd-1')).toHaveLength(1)
    expect((await workItems.find({ workItemId: workItem.id })).status).toBe(EFactoryWorkItemStatus.Merged)
  })

  it('re-labeling an already-tracked issue does not mint a second intake event', async () => {
    await service.handle({ event: 'issues', deliveryId: 'd-1', payload: issuesLabeledPayload() })

    const outcome = await service.handle({
      event: 'issues',
      deliveryId: 'd-2',
      payload: issuesLabeledPayload(),
    })

    expect(outcome.kind).toBe(EFactoryEventKind.StatusChange)
    expect(fake.workItems).toHaveLength(1)
    expect(fake.transcriptEvents.filter((one) => one.kind === EFactoryEventKind.Intake)).toHaveLength(1)
  })

  it('pull_request_review submitted and review comments append review events with association', async () => {
    await workItems.intake({
      organizationId: DEFAULT_ORGANIZATION_ID,
      repo: REPO,
      sourceKind: 'github',
      surface: 'github',
      externalId: `${REPO}/pull/87`,
      aliasKind: 'pull-request',
    })

    const review = await service.handle({
      event: 'pull_request_review',
      deliveryId: 'd-1',
      payload: {
        action: 'submitted',
        pull_request: { number: 87, merged: false },
        review: { author_association: 'MEMBER' },
        repository: { full_name: REPO },
        sender: { login: 'tofik' },
      },
    })
    const reviewComment = await service.handle({
      event: 'pull_request_review_comment',
      deliveryId: 'd-2',
      payload: {
        action: 'created',
        pull_request: { number: 87, merged: false },
        comment: { author_association: 'OWNER' },
        repository: { full_name: REPO },
        sender: { login: 'dennislysenko' },
      },
    })

    expect(review.kind).toBe(EFactoryEventKind.Review)
    expect(reviewComment.kind).toBe(EFactoryEventKind.Review)
    expect(fake.transcriptEvents).toMatchObject([
      { kind: EFactoryEventKind.Review, author: 'tofik', authorAssociation: 'member' },
      { kind: EFactoryEventKind.Review, author: 'dennislysenko', authorAssociation: 'owner' },
    ])
  })

  it('a merged pull request appends a merged event and transitions the work item', async () => {
    const { workItem } = await workItems.intake({
      organizationId: DEFAULT_ORGANIZATION_ID,
      repo: REPO,
      sourceKind: 'github',
      surface: 'github',
      externalId: `${REPO}/pull/87`,
      aliasKind: 'pull-request',
    })

    const outcome = await service.handle({
      event: 'pull_request',
      deliveryId: 'd-1',
      payload: pullRequestMergedPayload(),
    })

    expect(outcome).toEqual({
      handled: true,
      workItemId: workItem.id,
      kind: EFactoryEventKind.Merged,
      appended: true,
    })
    const found = await workItems.find({ workItemId: workItem.id })
    expect(found.status).toBe(EFactoryWorkItemStatus.Merged)
    expect(stations.stopRunningFor).toHaveBeenCalledWith({ workItemId: workItem.id })
    expect(drives.release).toHaveBeenCalledWith({ workItemId: workItem.id })
  })

  it('a closed issue stops its stations, releases the drive, and closes the work item', async () => {
    const { workItem } = await workItems.intake({
      organizationId: DEFAULT_ORGANIZATION_ID,
      repo: REPO,
      sourceKind: 'github',
      surface: 'github',
      externalId: `${REPO}#341`,
      aliasKind: 'issue',
    })

    const outcome = await service.handle({
      event: 'issues',
      deliveryId: 'd-closed',
      payload: {
        action: 'closed',
        issue: { number: 341 },
        repository: { full_name: REPO },
        sender: { login: 'dennislysenko' },
      },
    })

    expect(outcome).toMatchObject({ handled: true, workItemId: workItem.id, appended: true })
    expect((await workItems.find({ workItemId: workItem.id })).status).toBe(
      EFactoryWorkItemStatus.Closed,
    )
    expect(stations.stopRunningFor).toHaveBeenCalledWith({ workItemId: workItem.id })
    expect(drives.release).toHaveBeenCalledWith({ workItemId: workItem.id })
    expect(orchestrator.wake).toHaveBeenCalled()
  })

  it('a reopened issue returns the work item to active and wakes the orchestrator', async () => {
    const { workItem } = await workItems.intake({
      organizationId: DEFAULT_ORGANIZATION_ID,
      repo: REPO,
      sourceKind: 'github',
      surface: 'github',
      externalId: `${REPO}#341`,
      aliasKind: 'issue',
    })
    await workItems.transition({ workItemId: workItem.id, status: EFactoryWorkItemStatus.Closed })

    const outcome = await service.handle({
      event: 'issues',
      deliveryId: 'd-reopened',
      payload: {
        action: 'reopened',
        issue: { number: 341 },
        repository: { full_name: REPO },
        sender: { login: 'dennislysenko' },
      },
    })

    expect(outcome).toMatchObject({ handled: true, workItemId: workItem.id, appended: true })
    expect((await workItems.find({ workItemId: workItem.id })).status).toBe(
      EFactoryWorkItemStatus.Active,
    )
    expect(orchestrator.wake).toHaveBeenCalled()
    expect(drives.release).not.toHaveBeenCalled()
  })

  it('a closed but unmerged pull request is not handled', async () => {
    await workItems.intake({
      organizationId: DEFAULT_ORGANIZATION_ID,
      repo: REPO,
      sourceKind: 'github',
      surface: 'github',
      externalId: `${REPO}/pull/87`,
      aliasKind: 'pull-request',
    })

    const outcome = await service.handle({
      event: 'pull_request',
      deliveryId: 'd-1',
      payload: { ...(pullRequestMergedPayload() as Record<string, unknown>), pull_request: { number: 87, merged: false } },
    })

    expect(outcome).toEqual({ handled: false })
  })

  it('an unsupported event type is not handled', async () => {
    const outcome = await service.handle({ event: 'star', deliveryId: 'd-1', payload: {} })

    expect(outcome).toEqual({ handled: false })
  })

  it('an appended event wakes the orchestrator for that work item', async () => {
    const outcome = await service.handle({
      event: 'issues',
      deliveryId: 'd-1',
      payload: issuesLabeledPayload(),
    })

    expect(orchestrator.wake).toHaveBeenCalledTimes(1)
    const wakeArgs = orchestrator.wake.mock.calls[0]?.[0] as {
      workItemId: string
      externalId: string
    }
    expect(wakeArgs.workItemId).toBe(outcome.workItemId)
    expect(wakeArgs.externalId).toBe(`${REPO}#341`)
  })

  it('a deduplicated redelivery does not wake the orchestrator again', async () => {
    await service.handle({ event: 'issues', deliveryId: 'd-1', payload: issuesLabeledPayload() })
    await service.handle({ event: 'issues', deliveryId: 'd-1', payload: issuesLabeledPayload() })

    expect(orchestrator.wake).toHaveBeenCalledTimes(1)
  })

  it('an event on an untracked surface does not wake the orchestrator', async () => {
    await service.handle({ event: 'issue_comment', deliveryId: 'd-1', payload: issueCommentPayload() })

    expect(orchestrator.wake).not.toHaveBeenCalled()
  })
})
