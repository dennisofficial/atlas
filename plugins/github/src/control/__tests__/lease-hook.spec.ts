import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
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

import { githubControl } from '..'
import { githubCoreSlots } from '../../core'

const SESSION = 'ses_1'
const THREAD = 'thr_1'
const AT = '2026-11-08T10:00:00.000Z'

const created = (args: { id: string; provider?: string; target?: unknown }): V2Body => ({
  type: 'subscription-created',
  subscriptionId: args.id,
  provider: args.provider ?? 'github.pull-request',
  target: (args.target ?? { repo: 'github.com/Dltech/Atlas', number: 7 }) as never,
  label: 'dltech/atlas#7',
  createdBy: ESubscriptionActor.Agent,
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
    expect(row?.expiresAt.getTime()).toBeGreaterThan(Date.parse(AT))

    await append([ended('a')])
    expect(await rows()).toHaveLength(0)
  })

  it('is idempotent for a second subscription to the same pull request', async () => {
    const { append, rows } = await setup()
    await append([created({ id: 'a' })])
    await append([created({ id: 'b' })])
    expect(await rows()).toHaveLength(1)
  })

  it('writes no lease for another provider or an unreadable target, and ending one is harmless', async () => {
    const { append, rows } = await setup()
    await append([created({ id: 'x', provider: 'slack' })])
    await append([created({ id: 'y', target: { nope: true } })])
    await append([ended('y')])
    expect(await rows()).toHaveLength(0)
  })
})

describe('github plugin slots', () => {
  it('declares the subscribe and unsubscribe pod commands and one view', () => {
    expect(githubCoreSlots.commands.map((c) => c.spec.name)).toEqual(['subscribe', 'unsubscribe'])
    expect(githubCoreSlots.views.map((v) => v.name)).toEqual(['subscriptions'])
  })
})
