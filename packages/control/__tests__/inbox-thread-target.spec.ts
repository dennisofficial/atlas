import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'

import { chainEvents, toRunId, toThreadId, type V2Body } from '@dltech/atlas-core'

import { ControlPlane } from '../src/control-plane'
import { PostgresControlStore } from '../src/postgres'
import { claimableSessionIdsIn } from '../src/postgres/postgres-claim-candidates'

const testDb = useTestDatabase()

const NOW = '2026-11-21T12:00:00.000Z'
const SESSION = 'ses-child-target'
const USER = 'usr-child-target'
const MAIN = 'thread-main'
const CHILD = 'thread-child'
const HOLDER = 7101

const CHILD_THREAD = toThreadId(CHILD)

const messageOf = (params: { clientId: string; text: string }): string =>
  JSON.stringify({ clientId: params.clientId, text: params.text, via: 'operator' })

const setup = async (): Promise<ControlPlane> => {
  await seedUser({ db: testDb().db, id: USER })
  await testDb().db.orm.public.User.where({ id: USER }).updateAndCount({ active: true })
  const plane = new ControlPlane({
    store: new PostgresControlStore(testDb().db),
    clock: () => NOW,
  })
  await plane.createSession({
    sessionId: SESSION,
    userId: USER,
    projectId: null,
    mainThreadId: MAIN,
  })
  return plane
}

const appendOn = async (args: {
  plane: ControlPlane
  threadId: string
  epoch: number
  bodies: readonly V2Body[]
}) => {
  const head = await args.plane.head({ threadId: args.threadId })
  const outcome = await args.plane.append({
    threadId: args.threadId,
    epoch: args.epoch,
    events: chainEvents({
      threadId: toThreadId(args.threadId),
      runId: toRunId('run-1'),
      epoch: args.epoch,
      at: NOW,
      bodies: args.bodies,
      from: head,
    }),
  })
  if (!outcome.ok) throw new Error(`append refused: ${JSON.stringify(outcome.refusal)}`)
  return outcome.head
}

const candidates = (): Promise<string[]> =>
  testDb().db.transaction((tx) => claimableSessionIdsIn({ tx, now: NOW, limit: 10 }))

const prepared = async (options: { childEvents: boolean }) => {
  const plane = await setup()
  const { epoch } = await plane.grant({ sessionId: SESSION, hostId: HOLDER })
  await appendOn({ plane, threadId: MAIN, epoch, bodies: [{ type: 'workspace-prepared' }] })
  await plane.createThread({ threadId: CHILD, sessionId: SESSION })
  if (options.childEvents) {
    await appendOn({
      plane,
      threadId: CHILD,
      epoch,
      bodies: [{ type: 'user-said', text: 'earlier' }],
    })
  }
  await plane.revoke({ sessionId: SESSION, wantsHolder: false })
  return plane
}

describe('an inbox row targeted at a child thread', () => {
  it('stays out of the main inbox and shows up in the child inbox', async () => {
    const plane = await setup()
    await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: messageOf({ clientId: 'c-1', text: 'go' }),
      threadId: CHILD_THREAD,
    })

    expect(await plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 10 })).toEqual([])
    const child = await plane.readInbox({
      sessionId: SESSION,
      afterId: 0,
      limit: 10,
      forThread: CHILD_THREAD,
    })
    expect(child.map((entry) => [entry.threadId, entry.kind])).toEqual([[CHILD_THREAD, 'message']])
  })

  it('makes two rows when the same client id is posted on the main and the child thread', async () => {
    const plane = await setup()
    const payload = messageOf({ clientId: 'c-1', text: 'go' })
    const main = await plane.post({ sessionId: SESSION, kind: 'message', payload })
    const child = await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload,
      threadId: CHILD_THREAD,
    })

    expect([main.inboxId, child.inboxId]).toEqual([1, 2])
  })

  it('is consumed with the seq of the child thread that staged it', async () => {
    const plane = await setup()
    const posted = await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: messageOf({ clientId: 'c-1', text: 'go' }),
      threadId: CHILD_THREAD,
    })
    await plane.createThread({ threadId: CHILD, sessionId: SESSION })
    const { epoch } = await plane.grant({ sessionId: SESSION, hostId: HOLDER })
    await appendOn({
      plane,
      threadId: CHILD,
      epoch,
      bodies: [
        {
          type: 'input-posted',
          inboxId: posted.inboxId,
          kind: 'message',
          postedAt: NOW,
          text: 'go',
        },
      ],
    })

    const entry = await plane.readInboxEntry({ sessionId: SESSION, inboxId: posted.inboxId })
    expect(entry?.consumedSeq).toBe(1)
    expect(
      await plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 10, forThread: CHILD_THREAD }),
    ).toEqual([])
  })

  it('makes its session claimable while the child thread has events', async () => {
    const plane = await prepared({ childEvents: true })
    await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: messageOf({ clientId: 'c-1', text: 'go' }),
      threadId: CHILD_THREAD,
    })

    expect(await candidates()).toContain(SESSION)
  })

  it('never makes its session claimable when the child thread has no events', async () => {
    const plane = await prepared({ childEvents: false })
    await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: messageOf({ clientId: 'c-1', text: 'go' }),
      threadId: CHILD_THREAD,
    })

    expect(await candidates()).not.toContain(SESSION)
  })
})
