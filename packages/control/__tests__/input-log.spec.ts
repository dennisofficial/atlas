import { describe, expect, it } from 'bun:test'

import { chainEvents, ESessionStatus, toRunId, toThreadId, type V2Body } from '@dltech/atlas-core'

import { ControlPlane, readSessionStatus } from '../src'
import { InMemoryControlStore } from '../src/testing/memory'

const NOW = '2026-11-06T12:00:00.000Z'
const SESSION = 'session-1'
const THREAD = 'thread-1'

const setup = async () => {
  const store = new InMemoryControlStore({ clock: () => NOW })
  const plane = new ControlPlane({ store })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-a',
    projectId: 'project-a',
    mainThreadId: THREAD,
  })
  const lease = await plane.grant({ sessionId: SESSION, hostId: 7 })
  const append = async (args: { bodies: readonly V2Body[] }) => {
    const outcome = await plane.append({
      threadId: THREAD,
      epoch: lease.epoch,
      events: chainEvents({
        threadId: toThreadId(THREAD),
        runId: toRunId('run-1'),
        epoch: lease.epoch,
        at: NOW,
        bodies: args.bodies,
        from: await plane.head({ threadId: THREAD }),
      }),
    })
    if (!outcome.ok) throw new Error(`append refused: ${JSON.stringify(outcome.refusal)}`)
    return outcome.head
  }
  return { store, plane, append, epoch: lease.epoch }
}

const posted = (inboxId: number, text: string): V2Body => ({
  type: 'input-posted',
  inboxId,
  kind: 'message',
  postedAt: NOW,
  text,
})

const said = (inboxId: number, text: string): V2Body => ({
  type: 'user-said',
  text,
  requestId: `inbox:${inboxId}`,
  inboxId,
})

const messageOf = (clientId: string, text: string): string =>
  JSON.stringify({ text, clientId, via: 'operator' })

describe('readEvents at a commit boundary', () => {
  it('never ends a page on an input-posted, even when that overruns the limit', async () => {
    const { plane, append } = await setup()
    await append({ bodies: [posted(1, 'a'), said(1, 'a')] })
    await append({ bodies: [posted(2, 'b'), said(2, 'b')] })

    const first = await plane.readEvents({
      threadId: THREAD,
      afterSeq: 0,
      limit: 1,
      visible: true,
    })
    expect(first.events.map((event) => event.type)).toEqual(['input-posted', 'user-said'])
    expect(first.next).toBe(2)

    const second = await plane.readEvents({
      threadId: THREAD,
      afterSeq: first.next ?? 0,
      limit: 1,
      visible: true,
    })
    expect(second.events.map((event) => event.seq)).toEqual([3, 4])
    expect(second.next).toBeUndefined()
  })

  it('keeps a page that ends mid-commit open and extends it to the commit end', async () => {
    const { plane, append } = await setup()
    await append({ bodies: [posted(1, 'a'), posted(2, 'b'), said(1, 'a'), said(2, 'b')] })
    await append({ bodies: [{ type: 'workspace-prepared' }] })

    const page = await plane.readEvents({
      threadId: THREAD,
      afterSeq: 4,
      limit: 1,
      visible: true,
    })
    expect(page.events.map((event) => event.type)).toEqual(['workspace-prepared'])
    expect(page.next).toBeUndefined()
  })

  it('extends a page across a long run of input-posted in reads linear in the run', async () => {
    const { store, plane, append } = await setup()
    const run = 30
    const inboxIds = Array.from({ length: run }, (_, index) => index + 1)
    await append({ bodies: inboxIds.map((inboxId) => posted(inboxId, `m${inboxId}`)) })
    await append({ bodies: inboxIds.map((inboxId) => said(inboxId, `m${inboxId}`)) })
    let reads = 0
    const transact = store.transact.bind(store)
    store.transact = (work) =>
      transact((tx) => {
        const readEvents = tx.readEvents.bind(tx)
        tx.readEvents = (params) => {
          reads += 1
          return readEvents(params)
        }
        return work(tx)
      })

    const page = await plane.readEvents({
      threadId: THREAD,
      afterSeq: 0,
      limit: 1,
      visible: true,
    })

    expect(page.events.map((event) => event.seq)).toEqual(
      Array.from({ length: run + 1 }, (_, index) => index + 1),
    )
    expect(reads).toBeLessThanOrEqual(run + 2)
  })

  it('stops a commit-extended page at the head rather than inventing a next', async () => {
    const { plane, append } = await setup()
    await append({ bodies: [posted(1, 'a'), said(1, 'a')] })

    const page = await plane.readEvents({
      threadId: THREAD,
      afterSeq: 0,
      limit: 1,
      visible: true,
    })
    expect(page.events).toHaveLength(2)
    expect(page.next).toBeUndefined()
  })
})

describe('post with a clientId', () => {
  it('answers the same inboxId for a repeated clientId and a new one for a new clientId', async () => {
    const { plane } = await setup()
    const first = await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: messageOf('c-1', 'hi'),
    })
    const again = await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: messageOf('c-1', 'hi'),
    })
    const other = await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: messageOf('c-2', 'hi'),
    })

    expect(again.inboxId).toBe(first.inboxId)
    expect(other.inboxId).toBe(first.inboxId + 1)
    const inbox = await plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 10 })
    expect(inbox.map((entry) => entry.inboxId)).toEqual([first.inboxId, other.inboxId])
  })

  it('keeps a repeated clientId staged once so the queue folds one entry', async () => {
    const { plane, append } = await setup()
    const first = await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: messageOf('c-1', 'hi'),
    })
    await plane.post({ sessionId: SESSION, kind: 'message', payload: messageOf('c-1', 'hi') })
    await append({ bodies: [{ type: 'workspace-prepared' }] })
    await append({
      bodies: [
        {
          type: 'input-posted',
          inboxId: first.inboxId,
          kind: 'message',
          postedAt: NOW,
          text: 'hi',
          clientId: 'c-1',
        },
      ],
    })

    const status = await readSessionStatus({ plane, sessionId: SESSION, threadId: THREAD })
    expect(status.value.state).toBe(ESessionStatus.Queued)
    expect(status.value.queued).toEqual([
      { inboxId: first.inboxId, text: 'hi', postedAt: NOW, clientId: 'c-1' },
    ])
  })
})

describe('staging rows once logged', () => {
  it('hides a staged row as soon as its input-posted commit lands', async () => {
    const { plane, append } = await setup()
    const { inboxId } = await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: messageOf('c-1', 'hi'),
    })
    await append({
      bodies: [
        {
          type: 'input-posted',
          inboxId,
          kind: 'message',
          postedAt: NOW,
          text: 'hi',
          clientId: 'c-1',
        },
      ],
    })
    expect(await plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 10 })).toEqual([])
    expect((await plane.readInboxEntry({ sessionId: SESSION, inboxId }))?.consumedSeq).toBe(1)
  })

  it('keeps an input-posted row out of the inbox when the same commit says it', async () => {
    const { plane, append } = await setup()
    const { inboxId } = await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: messageOf('c-2', 'hi'),
    })
    await append({ bodies: [posted(inboxId, 'hi'), said(inboxId, 'hi')] })
    expect(await plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 10 })).toEqual([])
  })
})
