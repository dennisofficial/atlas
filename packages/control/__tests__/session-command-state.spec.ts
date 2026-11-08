import { describe, expect, it } from 'bun:test'

import {
  chainEvents,
  ECompactionAnchor,
  EInputConsumed,
  toRunId,
  toThreadId,
  type V2Body,
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
  const post = (name: string) =>
    plane.post({ sessionId: SESSION, kind: `command:${name}`, payload: '{}' })
  const commands = async () =>
    (await readSessionStatus({ plane, sessionId: SESSION, threadId: THREAD })).value.commands
  const consume = (inboxId: number): V2Body => ({
    type: 'input-consumed',
    inboxId,
    consumed: EInputConsumed.Command,
  })
  return { append, post, commands, consume, plane }
}

const summarised = (inboxId?: number): V2Body => ({
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

  it('does not report a consumed message as a command', async () => {
    const { append, commands, plane } = await setup()
    const { inboxId } = await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: '{"text":"hi"}',
    })
    await append([{ type: 'input-consumed', inboxId }])
    expect(await commands()).toBeUndefined()
  })
})
