import { describe, expect, it } from 'bun:test'

import { chainEvents, toRunId, toThreadId, type V2Body } from '@dltech/atlas-core'

import { ControlPlane } from '../src/control-plane'
import { InMemoryControlStore } from '../src/testing/memory'

const NOW = '2026-11-21T12:00:00.000Z'
const SESSION = 'session-1'
const MAIN = 'thread-main'
const CHILD = 'thread-child'
const HOLDER = 7001
const OTHER_HOST = 7002

const CHILD_THREAD = toThreadId(CHILD)

const messageOf = (params: { clientId: string; text: string }): string =>
  JSON.stringify({ clientId: params.clientId, text: params.text, via: 'operator' })

const setup = async () => {
  const store = new InMemoryControlStore({ clock: () => NOW })
  const plane = new ControlPlane({ store, clock: () => NOW })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-a',
    projectId: 'project-a',
    mainThreadId: MAIN,
  })
  return { store, plane }
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

describe('an inbox row targeted at a child thread', () => {
  it('stays out of the main inbox and shows up in the child inbox', async () => {
    const { plane } = await setup()
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
    const { plane } = await setup()
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
    const { plane } = await setup()
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

  it('claims its session while the child thread has events', async () => {
    const { store, plane } = await setup()
    const { epoch } = await plane.grant({ sessionId: SESSION, hostId: HOLDER })
    await appendOn({ plane, threadId: MAIN, epoch, bodies: [{ type: 'workspace-prepared' }] })
    await plane.createThread({ threadId: CHILD, sessionId: SESSION })
    await appendOn({
      plane,
      threadId: CHILD,
      epoch,
      bodies: [{ type: 'user-said', text: 'earlier' }],
    })
    await plane.revoke({ sessionId: SESSION, wantsHolder: false })
    await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: messageOf({ clientId: 'c-1', text: 'go' }),
      threadId: CHILD_THREAD,
    })
    store.markHostPresent(OTHER_HOST)

    expect((await plane.claimNext({ hostId: OTHER_HOST, limit: 5 })).leases).toMatchObject([
      { sessionId: SESSION, holderHostId: OTHER_HOST },
    ])
  })

  it('never claims for a row whose child thread has no events', async () => {
    const { store, plane } = await setup()
    const { epoch } = await plane.grant({ sessionId: SESSION, hostId: HOLDER })
    await appendOn({ plane, threadId: MAIN, epoch, bodies: [{ type: 'workspace-prepared' }] })
    await plane.createThread({ threadId: CHILD, sessionId: SESSION })
    await plane.revoke({ sessionId: SESSION, wantsHolder: false })
    await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: messageOf({ clientId: 'c-1', text: 'go' }),
      threadId: CHILD_THREAD,
    })
    store.markHostPresent(OTHER_HOST)

    expect((await plane.claimNext({ hostId: OTHER_HOST, limit: 5 })).leases).toEqual([])
  })
})

describe('posting a main-thread-only kind at a child thread', () => {
  const kinds = ['stop', 'retry', 'operator-answer', 'withdraw', 'command:ping']

  for (const kind of kinds) {
    it(`refuses ${kind} with a named error and writes no row`, async () => {
      const { plane } = await setup()
      await expect(
        plane.post({ sessionId: SESSION, kind, payload: '{}', threadId: CHILD_THREAD }),
      ).rejects.toThrow('can only be posted on the main thread')
      expect(
        await plane.readInbox({
          sessionId: SESSION,
          afterId: 0,
          limit: 10,
          forThread: CHILD_THREAD,
        }),
      ).toEqual([])
    })
  }

  it('still posts the same kinds on the main thread', async () => {
    const { plane } = await setup()
    for (const kind of kinds) {
      await plane.post({ sessionId: SESSION, kind, payload: '{}' })
    }
    expect(
      (await plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 10 })).map(
        (entry) => entry.kind,
      ),
    ).toEqual(kinds)
  })
})
