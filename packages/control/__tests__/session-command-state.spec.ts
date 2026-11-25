import { describe, expect, it } from 'bun:test'

import {
  chainEvents,
  ECompactionAnchor,
  EInputConsumed,
  ESessionStatus,
  toRunId,
  toThreadId,
  type RecordEventBody,
} from '@dltech/atlas-core'
import { ECommandState } from '@dltech/atlas-protocol'

import { ControlPlane, readSessionStatus } from '../src'
import { InMemoryControlStore } from '../src/testing/memory'

const NOW = '2026-11-08T12:00:00.000Z'
const SESSION = 'session-1'
const THREAD = 'thread-1'

const setup = async () => {
  const plane = new ControlPlane({ store: new InMemoryControlStore({ clock: () => NOW }) })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-a',
    projectId: 'project-a',
    mainThreadId: THREAD,
  })
  const lease = await plane.grant({ sessionId: SESSION, hostId: 7 })
  const append = async (bodies: RecordEventBody[]) => {
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
  const post = async (name: string) => {
    const { inboxId } = await plane.post({
      sessionId: SESSION,
      kind: `command:${name}`,
      payload: '{}',
    })
    await append([{ type: 'input-posted', inboxId, kind: `command:${name}`, postedAt: NOW }])
    return { inboxId }
  }
  const commands = async () =>
    (await readSessionStatus({ plane, sessionId: SESSION, threadId: THREAD })).value.commands
  const consume = (inboxId: number): RecordEventBody => ({
    type: 'input-consumed',
    inboxId,
    consumed: EInputConsumed.Command,
  })
  return { append, post, commands, consume, plane }
}

const summarised = (inboxId?: number): RecordEventBody => ({
  type: 'history-summarised',
  fromSeq: 1,
  throughSeq: 1,
  anchor: ECompactionAnchor.Prefix,
  summary: 's',
  ...(inboxId === undefined ? {} : { inboxId }),
})

describe('session command state', () => {
  it('reports an unconsumed command as queued, then running, then drops it on its outcome', async () => {
    const { append, post, commands, consume } = await setup()
    const { inboxId } = await post('summarise')
    expect(await commands()).toEqual([
      { inboxId, name: 'summarise', postedAt: NOW, state: ECommandState.Queued },
    ])

    await append([consume(inboxId)])
    expect(await commands()).toEqual([
      { inboxId, name: 'summarise', postedAt: NOW, state: ECommandState.Running },
    ])

    await append([summarised(inboxId)])
    expect(await commands()).toBeUndefined()
  })

  it('drops a consumed command whose command has no outcome', async () => {
    const { append, post, commands, consume } = await setup()
    const { inboxId } = await post('subscribe')
    await append([consume(inboxId)])
    expect(await commands()).toBeUndefined()
  })

  it('drops a running command when it is refused', async () => {
    const { append, post, commands, consume } = await setup()
    const { inboxId } = await post('rewind')
    await append([consume(inboxId), { type: 'input-refused', inboxId, reason: 'no' }])
    expect(await commands()).toBeUndefined()
  })

  it('drops a running rewind when the outcome names it', async () => {
    const { append, post, commands, consume } = await setup()
    const { inboxId } = await post('rewind')
    await append([consume(inboxId)])
    expect((await commands())?.[0]?.state).toBe(ECommandState.Running)
    await append([{ type: 'history-rewound', toSeq: 0, inboxId }])
    expect(await commands()).toBeUndefined()
  })

  it('lists running before queued, each with its own name', async () => {
    const { append, post, commands, consume } = await setup()
    const running = await post('summarise')
    const waiting = await post('rewind')
    await append([consume(running.inboxId)])
    expect(await commands()).toEqual([
      { inboxId: running.inboxId, name: 'summarise', postedAt: NOW, state: ECommandState.Running },
      { inboxId: waiting.inboxId, name: 'rewind', postedAt: NOW, state: ECommandState.Queued },
    ])
  })

  it('treats a consumed command followed by an outcome without an inboxId as finished', async () => {
    const { append, post, commands, consume } = await setup()
    const { inboxId } = await post('summarise')
    await append([consume(inboxId), summarised()])
    expect(await commands()).toBeUndefined()
  })

  it('reports a consumed command the log never posted by the name it was consumed with', async () => {
    const { append, plane, commands } = await setup()
    const { inboxId } = await plane.post({
      sessionId: SESSION,
      kind: 'command:summarise',
      payload: '{}',
    })
    await append([
      {
        type: 'input-consumed',
        inboxId,
        consumed: EInputConsumed.Command,
        command: { name: 'summarise', argumentText: '', text: '/summarise' },
      },
    ])
    expect(await commands()).toEqual([
      { inboxId, name: 'summarise', postedAt: NOW, state: ECommandState.Running },
    ])
    const status = await readSessionStatus({ plane, sessionId: SESSION, threadId: THREAD })
    expect(status.value.state).toBe(ESessionStatus.RunningCommand)
    expect(status.value.reason).toBe('summarise')
  })

  it('reports the running command as the session status', async () => {
    const { append, post, consume, plane } = await setup()
    const { inboxId } = await post('summarise')
    await append([consume(inboxId)])
    const status = await readSessionStatus({ plane, sessionId: SESSION, threadId: THREAD })
    expect(status.value.state).toBe(ESessionStatus.RunningCommand)
    expect(status.value.reason).toBe('summarise')
    expect(status.value.since).toBe(NOW)
  })

  it('does not read idle while a command runs and a message waits unlogged', async () => {
    const { append, plane, post, consume } = await setup()
    const { inboxId } = await post('summarise')
    await append([consume(inboxId)])
    await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: JSON.stringify({ text: 'hi', via: 'operator' }),
    })
    const status = await readSessionStatus({ plane, sessionId: SESSION, threadId: THREAD })
    expect(status.value.state).toBe(ESessionStatus.RunningCommand)
    expect(status.value.reason).toBe('summarise')
  })

  it('reads queued while a posted message waits unlogged', async () => {
    const { plane } = await setup()
    const posted = await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: JSON.stringify({ text: 'hi', via: 'operator' }),
    })
    const status = await readSessionStatus({ plane, sessionId: SESSION, threadId: THREAD })
    expect(status.value.state).toBe(ESessionStatus.Queued)
    expect(status.value.since).toBe(NOW)
    expect(status.value.queued).toEqual([{ inboxId: posted.inboxId, text: 'hi', postedAt: NOW }])
  })

  it('leaves queued once the message is consumed', async () => {
    const { append, plane } = await setup()
    const posted = await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: JSON.stringify({ text: 'hi', via: 'operator' }),
    })
    await append([
      { type: 'input-posted', inboxId: posted.inboxId, kind: 'message', postedAt: NOW },
      { type: 'input-consumed', inboxId: posted.inboxId },
    ])
    const status = await readSessionStatus({ plane, sessionId: SESSION, threadId: THREAD })
    expect(status.value.state).toBe(ESessionStatus.Idle)
    expect(status.value.queued).toBeUndefined()
  })

  it('lists a session with a message waiting unlogged as queued', async () => {
    const { plane } = await setup()
    await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: JSON.stringify({ text: 'hi', via: 'operator' }),
    })
    const digests = await plane.listSessionDigests({
      userId: 'user-a',
      limit: 10,
      withView: true,
    })
    expect(digests[0]?.view?.status.state).toBe(ESessionStatus.Queued)
    expect(digests[0]?.view?.status.since).toBe(NOW)
  })

  it('does not report a consumed message as a command', async () => {
    const { append, commands, plane } = await setup()
    const { inboxId } = await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: '{"text":"hi","via":"operator"}',
    })
    await append([{ type: 'input-consumed', inboxId }])
    expect(await commands()).toBeUndefined()
  })
})
