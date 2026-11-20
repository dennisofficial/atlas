import { describe, expect, it } from 'bun:test'

import {
  chainEvents,
  EAttachmentStore,
  EInputConsumed,
  ESessionStatus,
  toRunId,
  toThreadId,
  type Attachment,
  type V2Body,
} from '@dltech/atlas-core'

import { ECommandState, ECredentialSource, ESandboxProvider } from '@dltech/atlas-protocol'

import { ControlPlane, MessageOriginRequiredError, readSessionStatus } from '../src'
import type { ControlTx } from '../src/port'
import { InMemoryControlStore } from '../src/testing/memory'

const NOW = '2026-11-05T12:00:00.000Z'
const SESSION = 'session-1'
const THREAD = 'thread-1'

const posted = (args: {
  inboxId: number
  kind?: string
  text?: string
  attachments?: readonly Attachment[]
}): V2Body => ({
  type: 'input-posted',
  inboxId: args.inboxId,
  kind: args.kind ?? 'message',
  postedAt: NOW,
  ...(args.text === undefined ? {} : { text: args.text }),
  ...(args.attachments === undefined ? {} : { attachments: args.attachments }),
})

const setup = async () => {
  const store = new InMemoryControlStore({ clock: () => NOW })
  const plane = new ControlPlane({ store })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-a',
    projectId: 'project-a',
    mainThreadId: THREAD,
  })
  const append = async (args: { epoch: number; bodies: V2Body[] }) => {
    const outcome = await plane.append({
      threadId: THREAD,
      epoch: args.epoch,
      events: chainEvents({
        threadId: toThreadId(THREAD),
        runId: toRunId('run-1'),
        epoch: args.epoch,
        at: NOW,
        bodies: args.bodies,
        from: await plane.head({ threadId: THREAD }),
      }),
    })
    if (!outcome.ok) throw new Error('append refused')
  }
  const read = () => readSessionStatus({ plane, sessionId: SESSION, threadId: THREAD })
  return { store, plane, append, read }
}

describe('readSessionStatus', () => {
  it('reads a fresh session as preparing at seq 0 with no holder', async () => {
    const { read } = await setup()
    expect(await read()).toEqual({
      at: 0,
      value: {
        state: ESessionStatus.Preparing,
        lease: { epoch: 0, holderHostId: null, live: false },
        sandboxProvider: ESandboxProvider.Agent37,
        credentialSource: ECredentialSource.Platform,
      },
    })
  })

  it('stamps the head it folded and reports a live holder', async () => {
    const { store, plane, append, read } = await setup()
    store.markHostPresent(7)
    const lease = await plane.grant({ sessionId: SESSION, hostId: 7 })
    await append({
      epoch: lease.epoch,
      bodies: [{ type: 'workspace-prepared' }, { type: 'user-said', text: 'hi' }],
    })
    const status = await read()
    expect(status.at).toBe(2)
    expect(status.value.state).toBe(ESessionStatus.Thinking)
    expect(status.value.lease).toEqual({ epoch: lease.epoch, holderHostId: 7, live: true })
  })

  it('reads an unconsumed inbox entry as queued', async () => {
    const { plane, append, read } = await setup()
    const lease = await plane.grant({ sessionId: SESSION, hostId: 7 })
    await append({ epoch: lease.epoch, bodies: [{ type: 'workspace-prepared' }] })
    const { inboxId } = await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: '{"text":"hi","via":"operator"}',
    })
    await append({ epoch: lease.epoch, bodies: [posted({ inboxId, text: 'hi' })] })
    expect((await read()).value.state).toBe(ESessionStatus.Queued)
  })

  it('lists pending message entries oldest first and drops withdrawn and consumed ones', async () => {
    const { plane, append, read } = await setup()
    const lease = await plane.grant({ sessionId: SESSION, hostId: 7 })
    await append({ epoch: lease.epoch, bodies: [{ type: 'workspace-prepared' }] })
    const a = await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: '{"text":"a","via":"operator"}',
    })
    const b = await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: '{"text":"b","via":"operator"}',
    })
    const stop = await plane.post({ sessionId: SESSION, kind: 'stop', payload: '{}' })
    await expect(
      plane.post({ sessionId: SESSION, kind: 'message', payload: 'not json' }),
    ).rejects.toThrow(MessageOriginRequiredError)
    const c = await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: '{"text":"c","via":"operator"}',
    })
    await append({
      epoch: lease.epoch,
      bodies: [
        posted({ inboxId: a.inboxId, text: 'a' }),
        posted({ inboxId: b.inboxId, text: 'b' }),
        posted({ inboxId: stop.inboxId, kind: 'stop' }),
        posted({ inboxId: c.inboxId, text: 'c' }),
      ],
    })

    const listed = (await read()).value.queued
    expect(listed?.map(({ inboxId, text }) => [inboxId, text])).toEqual([
      [a.inboxId, 'a'],
      [b.inboxId, 'b'],
      [c.inboxId, 'c'],
    ])
    expect(listed?.[0]?.postedAt).toBe(NOW)

    const { requestInboxId } = await plane.withdraw({
      sessionId: SESSION,
      inboxId: b.inboxId,
    })
    await append({
      epoch: lease.epoch,
      bodies: [{ type: 'input-withdrawn', inboxId: b.inboxId, requestInboxId }],
    })
    expect((await read()).value.queued?.map((entry) => entry.text)).toEqual(['a', 'c'])
  })

  it('carries the attachments of a queued message', async () => {
    const { plane, append, read } = await setup()
    const lease = await plane.grant({ sessionId: SESSION, hostId: 7 })
    await append({ epoch: lease.epoch, bodies: [{ type: 'workspace-prepared' }] })
    const attachments: Attachment[] = [
      {
        id: 'm1',
        name: 'shot.png',
        mediaType: 'image/png',
        size: 10,
        source: 'shot.png',
        content: { store: EAttachmentStore.Media, hash: 'a'.repeat(64) },
        image: { width: 2, height: 3 },
      },
      {
        id: 'u1',
        name: 'deploy.sh',
        mediaType: 'text/x-sh',
        size: 7,
        content: {
          store: EAttachmentStore.Upload,
          uploadId: '0b6c1f9e-2d4a-4c1b-9f3e-7a2b5c8d1e40',
          pathname: 'composer-uploads/user-a/0b6c1f9e-2d4a-4c1b-9f3e-7a2b5c8d1e40/deploy.sh',
        },
      },
    ]
    const look = await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: JSON.stringify({ text: 'look', via: 'operator' }),
    })
    const plain = await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: '{"text":"plain","via":"operator"}',
    })
    await append({
      epoch: lease.epoch,
      bodies: [
        posted({ inboxId: look.inboxId, text: 'look', attachments }),
        posted({ inboxId: plain.inboxId, text: 'plain' }),
      ],
    })

    const listed = (await read()).value.queued
    expect(listed?.[0]).toMatchObject({ text: 'look', attachments })
    expect(listed?.[1]?.attachments).toBeUndefined()
  })

  it('lists a posted command beside queued and keeps it as running once consumed', async () => {
    const { plane, append, read } = await setup()
    const lease = await plane.grant({ sessionId: SESSION, hostId: 7 })
    await append({ epoch: lease.epoch, bodies: [{ type: 'workspace-prepared' }] })
    const message = await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: '{"text":"hi","via":"operator"}',
    })
    const command = await plane.post({
      sessionId: SESSION,
      kind: 'command:rename',
      payload: '{"title":"x"}',
    })
    await append({
      epoch: lease.epoch,
      bodies: [
        posted({ inboxId: message.inboxId, text: 'hi' }),
        posted({ inboxId: command.inboxId, kind: 'command:rename' }),
      ],
    })

    const listed = (await read()).value
    expect(listed.commands).toEqual([
      { inboxId: command.inboxId, name: 'rename', postedAt: NOW, state: ECommandState.Queued },
    ])
    expect(listed.queued?.map((entry) => entry.inboxId)).toEqual([message.inboxId])

    await append({
      epoch: lease.epoch,
      bodies: [
        { type: 'input-consumed', inboxId: command.inboxId, consumed: EInputConsumed.Command },
      ],
    })
    expect((await read()).value.commands).toEqual([
      { inboxId: command.inboxId, name: 'rename', postedAt: NOW, state: ECommandState.Running },
    ])
  })

  it('omits queued when nothing is pending', async () => {
    const { read } = await setup()
    expect((await read()).value.queued).toBeUndefined()
  })

  it('folds only the tail of a log longer than one read', async () => {
    const { plane, append, read } = await setup()
    const lease = await plane.grant({ sessionId: SESSION, hostId: 7 })
    await append({
      epoch: lease.epoch,
      bodies: [
        { type: 'workspace-prepared' },
        ...Array.from({ length: 1000 }, (): V2Body => ({ type: 'user-said', text: 'filler' })),
        { type: 'assistant-said', parts: [{ type: 'text', text: 'done' }] },
      ],
    })
    const status = await read()
    expect(status.at).toBe(1002)
    expect(status.value.state).toBe(ESessionStatus.Idle)
  })

  it('reads a start failure as failed with its reason until a newer message arrives', async () => {
    const { plane, append, read } = await setup()
    const lease = await plane.grant({ sessionId: SESSION, hostId: 7 })
    await append({ epoch: lease.epoch, bodies: [{ type: 'workspace-prepared' }] })
    const first = await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: '{"text":"a","via":"operator"}',
    })
    await append({
      epoch: lease.epoch,
      bodies: [
        {
          type: 'session-start-failed',
          reason: 'sandbox is not configured',
          inboxHead: first.inboxId,
          permanent: true,
        },
      ],
    })
    expect((await read()).value).toMatchObject({
      state: ESessionStatus.StartFailed,
      reason: 'sandbox is not configured',
    })
    const second = await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: '{"text":"b","via":"operator"}',
    })
    await append({ epoch: lease.epoch, bodies: [posted({ inboxId: second.inboxId, text: 'b' })] })
    expect((await read()).value.state).toBe(ESessionStatus.Queued)
  })
})

class ReorderingStore extends InMemoryControlStore {
  private transactions = 0
  private injecting = false
  private release: (() => void) | undefined
  private readonly released = new Promise<void>((resolve) => {
    this.release = resolve
  })
  private plan: { deferred: number; after: number; commit: () => Promise<void> } | undefined

  arm(plan: { deferred: number; after: number; commit: () => Promise<void> }): void {
    this.transactions = 0
    this.plan = plan
  }

  override async transact<T>(work: (tx: ControlTx) => Promise<T>): Promise<T> {
    if (this.injecting) return super.transact(work)
    this.transactions += 1
    const index = this.transactions
    const { plan } = this
    if (plan === undefined) return super.transact(work)
    if (index === plan.deferred) await this.released
    const result = await super.transact(work)
    if (index === plan.after) {
      this.injecting = true
      await plan.commit()
      this.injecting = false
      this.release?.()
    }
    return result
  }
}

describe('readSessionStatus under a concurrent consume', () => {
  it('never reports Sent at the sequence of the log that consumed the entry', async () => {
    const store = new ReorderingStore({ clock: () => NOW })
    const plane = new ControlPlane({ store })
    await plane.createSession({
      sessionId: SESSION,
      userId: 'user-a',
      projectId: 'project-a',
      mainThreadId: THREAD,
    })
    const lease = await plane.grant({ sessionId: SESSION, hostId: 7 })
    const append = async (bodies: V2Body[]) => {
      const outcome = await plane.append({
        threadId: THREAD,
        epoch: lease.epoch,
        events: chainEvents({
          threadId: toThreadId(THREAD),
          runId: toRunId('run-1'),
          epoch: lease.epoch,
          at: NOW,
          bodies,
          from: await plane.head({ threadId: THREAD }),
        }),
      })
      if (!outcome.ok) throw new Error('append refused')
    }
    await append([{ type: 'workspace-prepared' }])
    const posted = await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: '{"text":"hi","via":"operator"}',
    })
    store.arm({
      deferred: 2,
      after: 3,
      commit: () =>
        append([
          { type: 'input-consumed', inboxId: posted.inboxId },
          { type: 'user-said', text: 'hi', requestId: `inbox:${posted.inboxId}` },
        ]),
    })

    const status = await readSessionStatus({
      plane,
      sessionId: SESSION,
      threadId: THREAD,
    })

    expect(status.value.state === ESessionStatus.Queued && status.at > 1).toBe(false)
  })
})
