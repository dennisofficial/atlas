import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import {
  chainEvents,
  createRecordEventSchema,
  toRunId,
  toThreadId,
  type RecordEventBody,
} from '@dltech/atlas-core'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'

import { githubControl, TRACKING_TARGET_TTL_MS } from '..'

const SESSION = 'ses_1'
const THREAD = 'thr_1'
const AT = '2026-11-08T10:00:00.000Z'

const observed = (overrides: Record<string, unknown> = {}): RecordEventBody =>
  ({
    type: 'branches-observed',
    repo: '/atlas/workspaces/workspace',
    head: 'dennis/feature',
    base: 'main',
    branches: [
      { name: 'main', sha: 'a1' },
      { name: 'dennis/feature', sha: 'b2', pushRemote: 'fork' },
    ],
    worktrees: [],
    remotes: [
      { name: 'origin', url: 'git@github.com:Dltech/Atlas.git' },
      { name: 'fork', url: 'https://github.com/Dennis/Atlas.git' },
    ],
    checkouts: ['dennis/old'],
    ...overrides,
  }) as never

describe('github tracking target hook on append (postgres)', () => {
  const testDb = useTestDatabase()

  const setup = async () => {
    const { db } = testDb()
    await seedUser({ db, id: 'usr_1' })
    const plane = new ControlPlane({
      store: new PostgresControlStore(db),
      eventSchema: createRecordEventSchema({ pluginBodies: [] }),
      appendHooks: githubControl.hooks,
    })
    await plane.createSession({
      sessionId: SESSION,
      userId: 'usr_1',
      projectId: 'prj_1',
      mainThreadId: THREAD,
    })
    const lease = await plane.grant({ sessionId: SESSION, hostId: 9001 })
    const append = async (bodies: RecordEventBody[], at: string = AT) => {
      const outcome = await plane.append({
        threadId: THREAD,
        epoch: lease.epoch,
        events: chainEvents({
          threadId: toThreadId(THREAD),
          runId: toRunId('r1'),
          epoch: lease.epoch,
          at,
          bodies,
          from: await plane.head({ threadId: THREAD }),
        }),
      })
      if (!outcome.ok) throw new Error(JSON.stringify(outcome.refusal))
    }
    const targets = () =>
      db.orm.public.GithubTrackingTarget.where({ userId: 'usr_1' })
        .orderBy((row) => row.kind.asc())
        .all()
    return { append, targets }
  }

  it('records a head target per worked branch, keyed by the branch push remote', async () => {
    const { append, targets } = await setup()

    await append([observed()])

    expect(
      (await targets()).map((row) => ({
        kind: row.kind,
        repo: row.repoFullName,
        branch: row.branch,
        prNumber: row.prNumber,
      })),
    ).toEqual([
      { kind: 'head', repo: 'dennis/atlas', branch: 'dennis/feature', prNumber: 0 },
      { kind: 'head', repo: 'dltech/atlas', branch: 'dennis/old', prNumber: 0 },
    ])
  })

  it('expires a target seven days after the observation', async () => {
    const { append, targets } = await setup()

    await append([observed()])

    const [first] = await targets()
    expect(first?.liveUntil.toISOString()).toBe(
      new Date(Date.parse(AT) + TRACKING_TARGET_TTL_MS).toISOString(),
    )
    expect(first?.lookedUpAt).toBeNull()
  })

  it('refreshes the expiry when the same head is observed again, without a second row', async () => {
    const { append, targets } = await setup()
    await append([observed()])
    const later = '2026-11-10T10:00:00.000Z'

    await append([observed({ head: 'dennis/feature', checkouts: ['dennis/old'] })], later)

    const rows = await targets()
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.liveUntil.toISOString()).toBe(
        new Date(Date.parse(later) + TRACKING_TARGET_TTL_MS).toISOString(),
      )
    }
  })
})
