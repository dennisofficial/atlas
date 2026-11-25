import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import { toCallId, toRunId, toThreadId, type MediaRef } from '@dltech/atlas-core'

import { RemoteCalls } from '../../calls/remote-calls'
import { childRecordOf, type ChildRunArgs } from '../crew/child-record'
import type { PictureStore } from '../record/record-pictures'

const SESSION = 'session-1'
const PARENT = toThreadId('thread-parent')
const CHILD = toThreadId('thread-child')
const AT = '2026-11-25T12:00:00.000Z'
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const MEDIA: MediaRef = {
  hash: 'a'.repeat(64),
  mediaType: 'image/png',
  size: 70,
  width: 1,
  height: 1,
}

const timers = {
  now: () => Date.parse(AT),
  setTimeout: () => 0,
  clearTimeout: () => {},
  random: () => 0.5,
}

const argsOf = (args: {
  plane: ControlPlane
  epoch: number
  pictures: PictureStore
}): ChildRunArgs =>
  ({
    deps: { sessionId: SESSION, plane: args.plane, timers, appendRetryMs: 5 },
    runtime: {
      daemonTools: new Set<string>(),
      effectOf: () => 'write',
      remoteCalls: new RemoteCalls({
        sessionId: SESSION,
        token: 'token',
        timers,
        connector: async () => {
          throw new Error('the child append never reaches a sandbox')
        },
        onFenced: () => {},
      }),
      pictures: args.pictures,
    },
    parentRecord: {},
    parentThreadId: PARENT,
    epoch: args.epoch,
    agentType: 'general-purpose',
    intent: 'take a screenshot',
    signal: new AbortController().signal,
    onLeaseLost: () => undefined,
  }) as unknown as ChildRunArgs

const storedPicturesOf = (): {
  calls: { bytes: Uint8Array; mediaType: string }[]
  store: PictureStore
} => {
  const calls: { bytes: Uint8Array; mediaType: string }[] = []
  return {
    calls,
    store: {
      store: async (args) => {
        calls.push(args)
        return MEDIA
      },
    },
  }
}

const toolResultWith = (part: unknown) =>
  ({
    type: 'tool-result',
    callId: toCallId('call-1'),
    name: 'read',
    modelParts: [part],
  }) as never

describe('a child run records its pictures through the session picture store', () => {
  it('commits an inline tool picture as a media part', async () => {
    const plane = new ControlPlane({ store: new InMemoryControlStore({ clock: () => AT }) })
    await plane.createSession({
      sessionId: SESSION,
      userId: 'user-1',
      projectId: 'project-1',
      mainThreadId: PARENT,
    })
    await plane.createThread({ threadId: CHILD, sessionId: SESSION })
    const { epoch } = await plane.grant({ sessionId: SESSION, hostId: 1 })
    const { calls, store } = storedPicturesOf()
    const record = await childRecordOf({
      args: argsOf({ plane, epoch, pictures: store }),
      agentId: CHILD,
      onLeaseLost: () => undefined,
    })

    await record.append({
      threadId: CHILD,
      runId: toRunId('run-1'),
      drafts: [
        toolResultWith({
          type: 'image',
          bytes: { kind: 'inline', data: PNG },
          mediaType: 'image/png',
        }),
      ],
    })

    const event = record.eventCache().eventsAfter(0)[0]
    expect(calls.length).toBe(1)
    expect(event?.type).toBe('tool-result')
    expect(
      event !== undefined && event.type === 'tool-result' ? event.modelParts : undefined,
    ).toEqual([{ type: 'media', media: MEDIA }])
    expect(JSON.stringify(event)).not.toContain(PNG)
  })
})
