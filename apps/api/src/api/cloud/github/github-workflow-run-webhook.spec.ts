import { useTestDatabase } from '@dltech/atlas-db/testing'
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { createV2EventSchema } from '@dltech/atlas-core'
import { db } from '@dltech/atlas-db'
import { INBOX_KIND_MESSAGE, inboxMessageSchema } from '@dltech/atlas-protocol'
import { beforeEach, describe, expect, it } from 'bun:test'

import { ensureUsers, seedSubscription } from '../../../../test/github-seed'
import type { WakeEventNotice } from './github-sandbox-wake-intent'
import type { GithubSandboxWakeService } from './github-sandbox-wake.service'
import type { GithubWorkflowRunWebhookPayload } from './github-webhook.types'
import { recordWorkflowRunFinished } from './github-workflow-run-webhook'

const USER = 'usr-1'
const V2_SESSION = 'ses_v2_run'
const V2_THREAD = 'thr_v2_run'

const seedV2Thread = async () => {
  const plane = new ControlPlane({
    store: new PostgresControlStore(db),
    eventSchema: createV2EventSchema({ pluginBodies: [] }),
  })
  await plane.createSession({
    sessionId: V2_SESSION,
    userId: USER,
    projectId: 'prj_1',
    mainThreadId: V2_THREAD,
  })
}

const inboxTexts = async (sessionId: string) => {
  const entries = await db.orm.v2.V2InboxEntry.where({ sessionId }).all()
  return entries.map((entry) => ({
    kind: entry.kind,
    text: inboxMessageSchema.parse(JSON.parse(entry.payload)).text,
  }))
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
    },
    repository: { full_name: repo },
  }
}

function wakeStub(): { wake: GithubSandboxWakeService; notices: WakeEventNotice[] } {
  const notices: WakeEventNotice[] = []
  const wake = {
    notifyEvent: (notice: WakeEventNotice) => notices.push(notice),
  } as unknown as GithubSandboxWakeService
  return { wake, notices }
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
    const { wake, notices } = wakeStub()

    expect(await recordWorkflowRunFinished({ payload: payloadOf(), wake })).toBe(1)
    expect(await recordWorkflowRunFinished({ payload: payloadOf(), wake })).toBe(0)

    expect(await inboxTexts(V2_SESSION)).toEqual([
      {
        kind: INBOX_KIND_MESSAGE,
        text: 'Workflow run ci #9001 in compai/app on main: completed, all jobs passed. https://github.com/compai/app/actions/runs/9001',
      },
    ])
    expect(notices).toEqual([{ userId: USER, repoFullName: 'compai/app', kind: 'workflow-run' }])
    const [row] = await rows()
    expect(row?.deliveredRunId).toBe('9001')
  })

  it('matches a workflow selector by run name and branch', async () => {
    await seedV2Thread()
    await seedRunRow({ branch: '#workflow:ci@main' })
    const { wake, notices } = wakeStub()

    expect(await recordWorkflowRunFinished({ payload: payloadOf({ name: 'ci' }), wake })).toBe(1)
    expect(notices).toHaveLength(1)
  })

  it('matches a workflow selector by the workflow path basename', async () => {
    await seedV2Thread()
    await seedRunRow({ branch: '#workflow:ci.yml@main' })
    const { wake } = wakeStub()

    expect(await recordWorkflowRunFinished({ payload: payloadOf({ name: 'CI' }), wake })).toBe(1)
  })

  it('leaves a workflow selector alone when the branch differs', async () => {
    await seedV2Thread()
    await seedRunRow({ branch: '#workflow:ci.yml@release' })
    const { wake, notices } = wakeStub()

    expect(await recordWorkflowRunFinished({ payload: payloadOf(), wake })).toBe(0)
    expect(notices).toHaveLength(0)
    const [row] = await rows()
    expect(row?.deliveredRunId).toBe('')
  })

  it('writes nothing for a payload that is not a completed run', async () => {
    await seedV2Thread()
    await seedRunRow()
    const { wake, notices } = wakeStub()

    expect(
      await recordWorkflowRunFinished({ payload: payloadOf({ action: 'requested' }), wake }),
    ).toBe(0)
    expect(
      await recordWorkflowRunFinished({
        payload: payloadOf({ status: 'in_progress' }),
        wake,
      }),
    ).toBe(0)

    expect(await inboxTexts(V2_SESSION)).toEqual([])
    expect(notices).toHaveLength(0)
  })

  it('does not match a run of another repo', async () => {
    await seedV2Thread()
    await seedRunRow()
    const { wake, notices } = wakeStub()

    expect(
      await recordWorkflowRunFinished({ payload: payloadOf({ repo: 'compai/other' }), wake }),
    ).toBe(0)
    expect(notices).toHaveLength(0)
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
    const { wake, notices } = wakeStub()

    expect(await recordWorkflowRunFinished({ payload: payloadOf(), wake })).toBe(0)
    expect(notices).toHaveLength(0)
  })
})
