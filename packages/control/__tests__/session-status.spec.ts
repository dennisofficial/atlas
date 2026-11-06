import { describe, expect, it } from 'bun:test'

import { chainEvents, ESessionStatus, toRunId, toThreadId, type V2Body } from '@dltech/atlas-core'

import { ControlPlane, readSessionStatus } from '../src'
import { InMemoryControlStore } from '../src/testing/memory'

const NOW = '2026-11-05T12:00:00.000Z'
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
  const read = () => readSessionStatus({ plane, sessionId: SESSION, threadId: THREAD, now: NOW })
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

  it('reads an unconsumed inbox entry as sent', async () => {
    const { plane, append, read } = await setup()
    const lease = await plane.grant({ sessionId: SESSION, hostId: 7 })
    await append({ epoch: lease.epoch, bodies: [{ type: 'workspace-prepared' }] })
    await plane.post({ sessionId: SESSION, kind: 'message', payload: '{"text":"hi"}' })
    expect((await read()).value.state).toBe(ESessionStatus.Sent)
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
    const first = await plane.post({ sessionId: SESSION, kind: 'message', payload: '{"text":"a"}' })
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
      state: ESessionStatus.Failed,
      reason: 'sandbox is not configured',
    })
    await plane.post({ sessionId: SESSION, kind: 'message', payload: '{"text":"b"}' })
    expect((await read()).value.state).toBe(ESessionStatus.Sent)
  })
})
