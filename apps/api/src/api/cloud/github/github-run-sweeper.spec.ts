import { useTestDatabase } from '@dltech/atlas-db/testing'
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { createV2EventSchema } from '@dltech/atlas-core'
import { db, type Row } from '@dltech/atlas-db'
import { INBOX_KIND_MESSAGE, inboxMessageSchema } from '@dltech/atlas-protocol'
import { beforeEach, describe, expect, it } from 'bun:test'

import { ensureUsers, seedSubscription } from '../../../../test/github-seed'
import { GithubRunSweeperService } from './github-run-sweeper.service'
import type { WakeEventNotice } from './github-sandbox-wake-intent'
import type { GithubSandboxWakeService } from './github-sandbox-wake.service'
import type { GithubWorkflowRunReads, WorkflowRunRead } from './github-workflow-run-reads'
import type { GithubService } from './github.service'

const USER = 'usr-1'
const THREAD = 'thr-1'
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

const runOf = (id: string, status: string): WorkflowRunRead => ({
  outcome: 'found',
  run: {
    id,
    status,
    conclusion: status === 'completed' ? 'success' : null,
    name: 'ci',
    headBranch: 'main',
    url: `https://github.com/compai/app/actions/runs/${id}`,
    failedJobs: [],
  },
})

function sweeperWith(args: {
  read?: GithubWorkflowRunReads['readWorkflowRun']
  latest?: GithubWorkflowRunReads['latestWorkflowRun']
  token?: string
}): { sweeper: GithubRunSweeperService; notices: WakeEventNotice[] } {
  const github = {
    findToken: async () => args.token,
  } as unknown as GithubService
  const reads = {
    readWorkflowRun: args.read ?? (async () => ({ outcome: 'not-found' })),
    latestWorkflowRun: args.latest ?? (async () => ({ outcome: 'not-found' })),
  } as unknown as GithubWorkflowRunReads
  const notices: WakeEventNotice[] = []
  const wake = {
    notifyEvent: (notice: WakeEventNotice) => notices.push(notice),
  } as unknown as GithubSandboxWakeService
  return { sweeper: new GithubRunSweeperService(github, reads, wake), notices }
}

const seedRunRow = (overrides: Partial<Row<'GithubSubscription'>> = {}) =>
  seedSubscription({
    userId: USER,
    branch: '#run:9001',
    prNumber: null,
    kind: 'workflow-run',
    deliveredRunId: '',
    threadId: THREAD,
    ...overrides,
  })

const rows = () => db.orm.public.GithubSubscription.all()

describe('GithubRunSweeperService', () => {
  useTestDatabase()

  beforeEach(async () => {
    await ensureUsers(USER)
  })

  it('wakes the thread once for a completed run, and the second tick is a no-op', async () => {
    await seedRunRow({ kind: 'workflow-run' })
    const { sweeper, notices } = sweeperWith({
      token: 'token',
      read: async () => runOf('9001', 'completed'),
    })

    await sweeper.handleSweep()
    await sweeper.handleSweep()

    expect(notices).toEqual([{ userId: USER, repoFullName: 'compai/app', kind: 'workflow-run' }])
    const [row] = await rows()
    expect(row?.deliveredRunId).toBe('9001')
  })

  it('leaves a run that is still going alone', async () => {
    await seedRunRow()
    const { sweeper, notices } = sweeperWith({
      token: 'token',
      read: async () => runOf('9001', 'in_progress'),
    })

    await sweeper.handleSweep()

    expect(notices).toHaveLength(0)
    const [row] = await rows()
    expect(row?.deliveredRunId).toBe('')
  })

  it('leaves a run it cannot read alone, for the TTL to expire it', async () => {
    await seedRunRow()
    const { sweeper, notices } = sweeperWith({
      token: 'token',
      read: async () => ({ outcome: 'unavailable' }),
    })

    await sweeper.handleSweep()

    expect(notices).toHaveLength(0)
    const [row] = await rows()
    expect(row?.deliveredRunId).toBe('')
  })

  it('reads the newest run for a workflow selector and locks it in', async () => {
    await seedRunRow({ branch: '#workflow:ci.yml@main' })
    const asked: Array<{ workflow: string; branch: string }> = []
    const { sweeper, notices } = sweeperWith({
      token: 'token',
      latest: async (args) => {
        asked.push({ workflow: args.workflow, branch: args.branch })
        return runOf('9002', 'completed')
      },
    })

    await sweeper.handleSweep()

    expect(asked).toEqual([{ workflow: 'ci.yml', branch: 'main' }])
    expect(notices).toHaveLength(1)
    const [row] = await rows()
    expect(row?.deliveredRunId).toBe('9002')
  })

  it('skips a run row whose thread is gone and one whose liveness expired', async () => {
    await seedRunRow({ threadId: '', branch: '#run:9001' })
    await seedRunRow({
      threadId: 'thr-2',
      branch: '#run:9002',
      liveUntil: new Date(Date.now() - 1),
    })
    const { sweeper, notices } = sweeperWith({
      token: 'token',
      read: async () => runOf('9001', 'completed'),
    })

    await sweeper.handleSweep()

    expect(notices).toHaveLength(0)
  })

  it('posts one inbox message into a v2 thread for a completed run, once over two ticks', async () => {
    await seedV2Thread()
    await seedRunRow({ threadId: V2_THREAD })
    const { sweeper, notices } = sweeperWith({
      token: 'token',
      read: async () => runOf('9001', 'completed'),
    })

    await sweeper.handleSweep()
    await sweeper.handleSweep()

    expect(await inboxTexts(V2_SESSION)).toEqual([
      {
        kind: INBOX_KIND_MESSAGE,
        text: 'Workflow run ci #9001 in compai/app on main: completed, all jobs passed. https://github.com/compai/app/actions/runs/9001',
      },
    ])
    expect(notices).toHaveLength(1)
    const [row] = await rows()
    expect(row?.deliveredRunId).toBe('9001')
  })

  it('still boots a v1 thread and posts nothing into an inbox', async () => {
    await seedV2Thread()
    await seedRunRow({ threadId: THREAD })
    const { sweeper, notices } = sweeperWith({
      token: 'token',
      read: async () => runOf('9001', 'completed'),
    })

    await sweeper.handleSweep()

    expect(notices).toEqual([{ userId: USER, repoFullName: 'compai/app', kind: 'workflow-run' }])
    expect(await inboxTexts(V2_SESSION)).toEqual([])
  })

  it('skips a user with no github token', async () => {
    await seedRunRow()
    const { sweeper, notices } = sweeperWith({
      read: async () => runOf('9001', 'completed'),
    })

    await sweeper.handleSweep()

    expect(notices).toHaveLength(0)
  })
})
