import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import {
  chainEvents,
  ESubscriptionActor,
  ESubscriptionEnd,
  toRunId,
  toThreadId,
  type V2Body,
} from '@dltech/atlas-core'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { createV2EventSchema } from '@dltech/atlas-core'

import { DEFAULT_SUBSCRIPTION_TTL_MS, githubControl } from '..'
import { githubCoreSlots } from '../../core'

const SESSION = 'ses_1'
const THREAD = 'thr_1'
const AT = '2026-11-08T10:00:00.000Z'

const created = (args: {
  id: string
  provider?: string
  target?: unknown
  expiresAt?: string
}): V2Body => ({
  type: 'subscription-created',
  subscriptionId: args.id,
  provider: args.provider ?? 'github.pull-request',
  target: (args.target ?? {
    repo: 'github.com/Dltech/Atlas',
    number: 7,
  }) as never,
  label: 'dltech/atlas#7',
  createdBy: ESubscriptionActor.Agent,
  ...(args.expiresAt === undefined ? {} : { expiresAt: args.expiresAt }),
})

const ended = (id: string): V2Body => ({
  type: 'subscription-ended',
  subscriptionId: id,
  reason: ESubscriptionEnd.Unsubscribed,
  by: ESubscriptionActor.Agent,
})

describe('github subscription lease hook on append (postgres)', () => {
  const testDb = useTestDatabase()

  const setup = async () => {
    const { db } = testDb()
    await seedUser({ db, id: 'usr_1' })
    const plane = new ControlPlane({
      store: new PostgresControlStore(db),
      eventSchema: createV2EventSchema({ pluginBodies: [] }),
      appendHooks: githubControl.hooks,
    })
    await plane.createSession({
      sessionId: SESSION,
      userId: 'usr_1',
      projectId: 'prj_1',
      mainThreadId: THREAD,
    })
    const lease = await plane.grant({ sessionId: SESSION, hostId: 9001 })
    const append = async (bodies: V2Body[]) => {
      const outcome = await plane.append({
        threadId: THREAD,
        epoch: lease.epoch,
        events: chainEvents({
          threadId: toThreadId(THREAD),
          runId: toRunId('r1'),
          epoch: lease.epoch,
          at: AT,
          bodies,
          from: await plane.head({ threadId: THREAD }),
        }),
      })
      if (!outcome.ok) throw new Error(JSON.stringify(outcome.refusal))
    }
    const rows = () => db.orm.public.GithubSubscription.where({ userId: 'usr_1' }).all()
    return { append, rows }
  }

  it('creates the transport lease in the append transaction and removes it on end', async () => {
    const { append, rows } = await setup()
    await append([created({ id: 'a' })])
    const [row] = await rows()
    expect(row).toMatchObject({
      repoFullName: 'dltech/atlas',
      prNumber: 7,
      branch: '#7',
      threadId: THREAD,
    })
    expect(row?.expiresAt.getTime()).toBe(Date.parse(AT) + DEFAULT_SUBSCRIPTION_TTL_MS)
    expect(row?.liveUntil.getTime()).toBe(row?.expiresAt.getTime())

    await append([ended('a')])
    expect(await rows()).toHaveLength(0)
  })

  it('uses the expiry the subscription declares instead of the default', async () => {
    const { append, rows } = await setup()
    const declared = '2026-11-08T10:30:00.000Z'
    await append([created({ id: 'a', expiresAt: declared })])
    expect((await rows())[0]?.expiresAt.toISOString()).toBe(declared)
  })

  it('falls back to the default when the declared expiry is unreadable', async () => {
    const { append, rows } = await setup()
    await append([created({ id: 'a', expiresAt: 'soon' })])
    expect((await rows())[0]?.expiresAt.getTime()).toBe(
      Date.parse(AT) + DEFAULT_SUBSCRIPTION_TTL_MS,
    )
  })

  it('is idempotent for a second subscription to the same pull request', async () => {
    const { append, rows } = await setup()
    await append([created({ id: 'a' })])
    await append([created({ id: 'b' })])
    expect(await rows()).toHaveLength(1)
  })

  it('writes a workflow-run row on the selector branch with no pull request number', async () => {
    const { append, rows } = await setup()
    await append([
      created({
        id: 'r',
        provider: 'github.workflow-run',
        target: { kind: 'run', repo: 'github.com/Dltech/Atlas', runId: 123 },
      }),
    ])
    expect(await rows()).toMatchObject([
      {
        repoFullName: 'dltech/atlas',
        prNumber: null,
        kind: 'workflow-run',
        branch: '#run:123',
        pollBacked: true,
        threadId: THREAD,
      },
    ])
    await append([ended('r')])
    expect(await rows()).toHaveLength(0)
  })

  it('writes no lease for another provider or an unreadable target, and ending one is harmless', async () => {
    const { append, rows } = await setup()
    await append([created({ id: 'x', provider: 'slack' })])
    await append([created({ id: 'y', target: { nope: true } })])
    await append([ended('y')])
    expect(await rows()).toHaveLength(0)
  })
})

describe('github subscription lease on append (memory)', () => {
  const planeWith = async () => {
    const store = new InMemoryControlStore()
    const plane = new ControlPlane({
      store,
      eventSchema: createV2EventSchema({ pluginBodies: [] }),
      appendHooks: githubControl.hooks,
    })
    await plane.createSession({
      sessionId: SESSION,
      userId: 'usr_1',
      projectId: 'prj_1',
      mainThreadId: THREAD,
    })
    const lease = await plane.grant({ sessionId: SESSION, hostId: 9001 })
    const append = async (bodies: V2Body[]) => {
      const outcome = await plane.append({
        threadId: THREAD,
        epoch: lease.epoch,
        events: chainEvents({
          threadId: toThreadId(THREAD),
          runId: toRunId('r1'),
          epoch: lease.epoch,
          at: AT,
          bodies,
          from: await plane.head({ threadId: THREAD }),
        }),
      })
      if (!outcome.ok) throw new Error(JSON.stringify(outcome.refusal))
    }
    return { append, leases: () => store.subscriptionLeases() }
  }

  it('lease the pull request under the #<number> branch as before', async () => {
    const { append, leases } = await planeWith()
    await append([created({ id: 'p' })])
    expect(leases()).toEqual([
      {
        userId: 'usr_1',
        threadId: THREAD,
        repo: 'github.com/dltech/atlas',
        subject: { kind: 'pull-request', number: 7 },
        expiresAt: new Date(Date.parse(AT) + DEFAULT_SUBSCRIPTION_TTL_MS).toISOString(),
      },
    ])
    await append([ended('p')])
    expect(leases()).toEqual([])
  })

  it('leases a pinned run and removes it when the subscription ends', async () => {
    const { append, leases } = await planeWith()
    await append([
      created({
        id: 'r',
        provider: 'github.workflow-run',
        target: { kind: 'run', repo: 'github.com/Dltech/Atlas', runId: 123 },
      }),
    ])
    expect(leases().map((lease) => lease.subject)).toEqual([
      { kind: 'workflow-run', selector: '#run:123' },
    ])
    await append([ended('r')])
    expect(leases()).toEqual([])
  })

  it('leases a workflow selector by its #workflow:<file>@<branch> position', async () => {
    const { append, leases } = await planeWith()
    await append([
      created({
        id: 'w',
        provider: 'github.workflow-run',
        target: {
          kind: 'selector',
          repo: 'github.com/Dltech/Atlas',
          workflow: 'deploy.yml',
          branch: 'main',
        },
      }),
    ])
    expect(leases().map((lease) => lease.subject)).toEqual([
      { kind: 'workflow-run', selector: '#workflow:deploy.yml@main' },
    ])
  })
})

describe('github plugin slots', () => {
  it('declares the subscribe and unsubscribe pod commands and one view', () => {
    expect(githubCoreSlots.commands.map((c) => c.spec.name)).toEqual(['subscribe', 'unsubscribe'])
    expect(githubCoreSlots.views.map((v) => v.name)).toEqual(['subscriptions'])
  })
})
