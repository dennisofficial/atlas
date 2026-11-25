import { useTestDatabase } from '@dltech/atlas-db/testing'
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import {
  createV2EventSchema,
  ESubscriptionActor,
  ESubscriptionEnd,
  INBOX_KIND_EVENT,
  INBOX_KIND_RECORD,
  inboxEventOf,
} from '@dltech/atlas-core'
import { db } from '@dltech/atlas-db'
import { beforeEach, describe, expect, it } from 'bun:test'

import { ensureUsers, seedSubscription } from './testing/github-seed'
import type { GithubWorkflowRunWebhookPayload } from './github-webhook.types'
import { recordWorkflowRunFinished } from './github-workflow-run-webhook'

const USER = 'usr-1'
const V2_SESSION = 'ses_v2_run'
const V2_THREAD = 'thr_v2_run'

const controlPlane = () =>
  new ControlPlane({
    store: new PostgresControlStore(db),
    eventSchema: createV2EventSchema({ pluginBodies: [] }),
  })

const seedV2Thread = async () => {
  await controlPlane().createSession({
    sessionId: V2_SESSION,
    userId: USER,
    projectId: 'prj_1',
    mainThreadId: V2_THREAD,
  })
}

const inboxEvents = async (sessionId: string) => {
  const entries = await db.orm.v2.V2InboxEntry.where({ sessionId }).all()
  return entries.map((entry) => ({ kind: entry.kind, read: inboxEventOf(entry.payload) }))
}

const runEventOf = (entry: Awaited<ReturnType<typeof inboxEvents>>[number]) => {
  if (!entry.read.ok) throw new Error(entry.read.reason)
  if (entry.read.event.type !== 'run-event') throw new Error(`expected a run-event`)
  return entry.read.event
}

const payloadOf = (
  overrides: {
    action?: string
    runId?: number
    name?: string
    path?: string
    branch?: string
    status?: string
    repo?: string
    createdAt?: string
  } = {},
): GithubWorkflowRunWebhookPayload => {
  const repo = overrides.repo ?? 'compai/app'
  const runId = overrides.runId ?? 9001
  return {
    action: overrides.action ?? 'completed',
    workflow_run: {
      id: runId,
      name: overrides.name ?? 'ci',
      path: overrides.path ?? '.github/workflows/ci.yml',
      status: overrides.status ?? 'completed',
      conclusion: 'success',
      head_branch: overrides.branch ?? 'main',
      html_url: `https://github.com/${repo}/actions/runs/${runId}`,
      created_at: overrides.createdAt ?? null,
    },
    repository: { full_name: repo },
  }
}

const seedRunRow = (overrides: Parameters<typeof seedSubscription>[0] = {}) =>
  seedSubscription({
    userId: USER,
    branch: '#run:9001',
    prNumber: null,
    kind: 'workflow-run',
    deliveredRunId: '',
    threadId: V2_THREAD,
    ...overrides,
  })

const rows = () => db.orm.public.GithubSubscription.all()

describe('recordWorkflowRunFinished', () => {
  useTestDatabase()

  beforeEach(async () => {
    await ensureUsers(USER)
  })

  it('posts the run notice once for a run selector, and a second delivery writes nothing', async () => {
    await seedV2Thread()
    await seedRunRow()

    expect(await recordWorkflowRunFinished({ payload: payloadOf() })).toBe(1)
    expect(await recordWorkflowRunFinished({ payload: payloadOf() })).toBe(0)

    const [entry] = await inboxEvents(V2_SESSION)
    if (entry === undefined) throw new Error('no inbox entry')
    expect(entry.kind).toBe(INBOX_KIND_EVENT)
    expect(runEventOf(entry)).toMatchObject({
      type: 'run-event',
      repo: 'compai/app',
      workflowRunId: 9001,
      workflow: 'ci',
      branch: 'main',
      url: 'https://github.com/compai/app/actions/runs/9001',
      status: 'completed',
      conclusion: 'success',
      failedJobs: [],
    })
    expect(await rows()).toEqual([])
  })

  it('records that the one-shot run subscription ended, and only once', async () => {
    await seedV2Thread()
    const held = await seedRunRow()

    expect(await recordWorkflowRunFinished({ payload: payloadOf() })).toBe(1)
    expect(await recordWorkflowRunFinished({ payload: payloadOf() })).toBe(0)

    const entries = await inboxEvents(V2_SESSION)
    const ended = entries.flatMap((entry) =>
      entry.kind === INBOX_KIND_RECORD &&
      entry.read.ok &&
      entry.read.event.type === 'subscription-ended'
        ? [entry.read.event]
        : [],
    )
    expect(ended).toEqual([
      {
        type: 'subscription-ended',
        subscriptionId: held.id,
        reason: ESubscriptionEnd.Completed,
        by: ESubscriptionActor.Provider,
      },
    ])
  })

  it('matches a workflow selector by run name and branch', async () => {
    await seedV2Thread()
    await seedRunRow({ branch: '#workflow:ci@main' })

    expect(await recordWorkflowRunFinished({ payload: payloadOf({ name: 'ci' }) })).toBe(1)
    expect(await inboxEvents(V2_SESSION)).toHaveLength(1)
  })

  it('matches a workflow selector by the workflow path basename', async () => {
    await seedV2Thread()
    await seedRunRow({ branch: '#workflow:ci.yml@main' })

    expect(await recordWorkflowRunFinished({ payload: payloadOf({ name: 'CI' }) })).toBe(1)
  })

  it('posts once per later-created run for a workflow selector, and not twice for the same run', async () => {
    await seedV2Thread()
    const at = new Date()
    const watermark = new Date(at.getTime() - 60_000)
    await seedRunRow({ branch: '#workflow:ci@main', lastRunCreatedAt: watermark })
    const firstRun = payloadOf({
      runId: 9001,
      createdAt: new Date(at.getTime() - 30_000).toISOString(),
    })
    const laterRun = payloadOf({ runId: 9002, createdAt: at.toISOString() })

    expect(await recordWorkflowRunFinished({ payload: firstRun })).toBe(1)
    expect(await recordWorkflowRunFinished({ payload: firstRun })).toBe(0)
    expect(await recordWorkflowRunFinished({ payload: laterRun })).toBe(1)

    expect(await inboxEvents(V2_SESSION)).toHaveLength(2)
    const [row] = await rows()
    expect(row?.deliveredRunId).toBe('')
    expect(row?.lastRunCreatedAt.getTime()).toBe(at.getTime())
  })

  it('notifies a selector made after the run started, once, and keeps its watermark on a re-subscribe', async () => {
    await seedV2Thread()
    const plane = controlPlane()
    const created = new Date(Date.now() - 60_000)
    const lease = {
      repo: 'github.com/compai/app',
      subject: { kind: 'workflow-run', selector: '#workflow:release.yml@main' } as const,
    }
    const target = {
      kind: 'selector',
      repo: 'github.com/compai/app',
      workflow: 'release.yml',
      branch: 'main',
    }
    await plane.subscribe({
      sessionId: V2_SESSION,
      threadId: V2_THREAD,
      provider: 'github.workflow-run',
      target,
      label: 'compai/app release.yml@main',
      events: [],
      lease,
      by: ESubscriptionActor.Agent,
    })
    const run = payloadOf({
      name: 'release',
      path: '.github/workflows/release.yml',
      createdAt: created.toISOString(),
    })

    expect(await recordWorkflowRunFinished({ payload: run })).toBe(1)
    expect(
      (await inboxEvents(V2_SESSION)).filter((entry) => entry.kind === INBOX_KIND_EVENT),
    ).toHaveLength(1)

    const again = await plane.subscribe({
      sessionId: V2_SESSION,
      threadId: V2_THREAD,
      provider: 'github.workflow-run',
      target,
      label: 'compai/app release.yml@main',
      events: ['completed'],
      lease,
      by: ESubscriptionActor.Agent,
    })

    expect(again.updated).toBe(true)
    expect(await recordWorkflowRunFinished({ payload: run })).toBe(0)
    expect(
      (await inboxEvents(V2_SESSION)).filter((entry) => entry.kind === INBOX_KIND_EVENT),
    ).toHaveLength(1)
    const [row] = await rows()
    expect(row?.lastRunCreatedAt.getTime()).toBe(created.getTime())
  })

  it('matches a workflow selector regardless of the case of the run name or path', async () => {
    await seedV2Thread()
    await seedRunRow({ branch: '#workflow:release.yml@main' })

    expect(
      await recordWorkflowRunFinished({
        payload: payloadOf({ name: 'Release', path: '.github/workflows/Release.yaml' }),
      }),
    ).toBe(1)
    expect(await inboxEvents(V2_SESSION)).toHaveLength(1)
  })

  it('posts nothing for a run created before the watermark of a workflow selector', async () => {
    await seedV2Thread()
    const at = new Date()
    await seedRunRow({ branch: '#workflow:ci@main', lastRunCreatedAt: at })
    const earlyRun = payloadOf({ createdAt: new Date(at.getTime() - 60_000).toISOString() })

    expect(await recordWorkflowRunFinished({ payload: earlyRun })).toBe(0)
    expect(await inboxEvents(V2_SESSION)).toHaveLength(0)
    const [row] = await rows()
    expect(row?.lastRunCreatedAt.getTime()).toBe(at.getTime())
  })

  it('leaves a workflow selector alone when the branch differs', async () => {
    await seedV2Thread()
    await seedRunRow({ branch: '#workflow:ci.yml@release' })

    expect(await recordWorkflowRunFinished({ payload: payloadOf() })).toBe(0)
    expect(await inboxEvents(V2_SESSION)).toHaveLength(0)
    const [row] = await rows()
    expect(row?.deliveredRunId).toBe('')
  })

  it('writes nothing for a payload that is not a completed run', async () => {
    await seedV2Thread()
    await seedRunRow()

    expect(await recordWorkflowRunFinished({ payload: payloadOf({ action: 'requested' }) })).toBe(0)
    expect(
      await recordWorkflowRunFinished({
        payload: payloadOf({ status: 'in_progress' }),
      }),
    ).toBe(0)

    expect(await inboxEvents(V2_SESSION)).toEqual([])
    expect(await inboxEvents(V2_SESSION)).toHaveLength(0)
  })

  it('does not match a run of another repo', async () => {
    await seedV2Thread()
    await seedRunRow()

    expect(await recordWorkflowRunFinished({ payload: payloadOf({ repo: 'compai/other' }) })).toBe(
      0,
    )
    expect(await inboxEvents(V2_SESSION)).toHaveLength(0)
    const [row] = await rows()
    expect(row?.deliveredRunId).toBe('')
  })

  it('skips a subscription whose thread is gone and one whose liveness expired', async () => {
    await seedRunRow({ threadId: '' })
    await seedRunRow({
      threadId: 'thr_expired',
      branch: '#run:9001',
      liveUntil: new Date(Date.now() - 1),
    })

    expect(await recordWorkflowRunFinished({ payload: payloadOf() })).toBe(0)
    expect(await inboxEvents(V2_SESSION)).toHaveLength(0)
  })
})
