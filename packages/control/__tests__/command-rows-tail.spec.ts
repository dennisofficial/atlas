import { describe, expect, it } from 'bun:test'
import {
  chainEvents,
  EInputConsumed,
  toRunId,
  toThreadId,
  type RecordEventBody,
} from '@dltech/atlas-core'
import { ECommandState } from '@dltech/atlas-protocol'

import { ControlPlane } from '../src'
import { COMMAND_TAIL_TYPES } from '../src/command-rows'
import type { ControlStorePort, ControlTx, ReadEventsParams, StoredEvent } from '../src/port'
import { VIEW_TAIL_LIMIT } from '../src/session-view-ops'
import { InMemoryControlStore } from '../src/testing/memory'

const NOW = '2026-11-08T12:00:00.000Z'
const SESSION = 'session-1'
const THREAD = 'thread-1'

type ReadCall = { params: ReadEventsParams; rows: number }

const recordingStoreOf = (
  store: ControlStorePort,
): { port: ControlStorePort; calls: ReadCall[] } => {
  const calls: ReadCall[] = []
  const recordingTx = (tx: ControlTx): ControlTx =>
    new Proxy(tx, {
      get(target, property) {
        const value = Reflect.get(target, property, target)
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => {
          const result = (value as (...callArgs: unknown[]) => unknown).apply(target, args)
          if (String(property) !== 'readEvents') return result
          return Promise.resolve(result as StoredEvent[] | Promise<StoredEvent[]>).then((rows) => {
            calls.push({ params: args[0] as ReadEventsParams, rows: rows.length })
            return rows
          })
        }
      },
    })
  const port = new Proxy(store, {
    get(target, property) {
      if (property === 'transact')
        return (work: (tx: ControlTx) => Promise<unknown>) =>
          target.transact((tx) => work(recordingTx(tx)))
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return { port, calls }
}

const filler: readonly RecordEventBody[] = Array.from({ length: 400 }, (_, index) => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text: `reply ${index}` }],
}))

const commandTailOf = (calls: readonly ReadCall[]): ReadCall[] =>
  calls.filter((call) => call.params.onlyTypes !== undefined)

const seeded = async () => {
  const store = new InMemoryControlStore({ clock: () => NOW })
  const { port, calls } = recordingStoreOf(store)
  const plane = new ControlPlane({ store: port, clock: () => NOW })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-a',
    projectId: 'project-a',
    mainThreadId: THREAD,
  })
  const lease = await plane.grant({ sessionId: SESSION, hostId: 7 })
  const append = async (bodies: readonly RecordEventBody[]) => {
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
  await append(filler)
  await append([
    { type: 'input-posted', inboxId: 7, kind: 'command:rewind', postedAt: NOW },
    { type: 'input-consumed', inboxId: 7, consumed: EInputConsumed.Command },
  ])
  await plane.readSessionView({ sessionId: SESSION, threadId: THREAD })
  calls.length = 0
  return { append, plane, calls }
}

describe('reading the running commands of a session view', () => {
  it('reads only the command rows of the thread tail, not the whole tail', async () => {
    const { plane, calls } = await seeded()
    const head = (await plane.head({ threadId: THREAD })).seq
    const afterSeq = Math.max(0, head - VIEW_TAIL_LIMIT)

    const unfiltered = await plane.readEvents({
      threadId: THREAD,
      afterSeq,
      limit: VIEW_TAIL_LIMIT,
      visible: true,
    })
    expect(unfiltered.events.length).toBe(filler.length + 2)

    const read = await plane.readSessionView({ sessionId: SESSION, threadId: THREAD })
    const tail = commandTailOf(calls)

    expect(read.value.status.commands).toEqual([
      { inboxId: 7, name: 'rewind', postedAt: NOW, state: ECommandState.Running },
    ])
    expect(tail).toHaveLength(1)
    expect(tail[0]?.params.onlyTypes).toEqual([...COMMAND_TAIL_TYPES])
    expect(tail[0]?.params.afterSeq).toBe(afterSeq)
    expect(tail[0]?.params.throughSeq).toBe(head)
    expect(tail[0]?.rows).toBe(2)
  })

  it('drops a command once an outcome event follows it', async () => {
    const { append, plane, calls } = await seeded()
    await append([{ type: 'command-applied', inboxId: 7, name: 'rewind' }])

    const read = await plane.readSessionView({ sessionId: SESSION, threadId: THREAD })

    expect(read.value.status.commands ?? []).toEqual([])
    expect(commandTailOf(calls)[0]?.rows).toBe(3)
  })
})
