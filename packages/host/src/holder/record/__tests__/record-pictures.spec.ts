import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import { toCallId, toRunId, toThreadId, type MediaRef } from '@dltech/atlas-core'

import { RemoteCalls } from '../../../calls/remote-calls'
import type { HostTimers } from '../../ports'
import { SessionRecord } from '../record-adapter'
import { storePictures, type PictureStore } from '../record-pictures'

const SESSION = 'session-1'
const THREAD = toThreadId('thread-1')
const AT = '2026-11-08T12:00:00.000Z'

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const MEDIA: MediaRef = {
  hash: 'a'.repeat(64),
  mediaType: 'image/png',
  size: 70,
  width: 1,
  height: 1,
}

const timers: HostTimers = {
  now: () => Date.parse(AT),
  setTimeout: () => 0,
  clearTimeout: () => {},
  random: () => 0.5,
}

const expiringTimers: HostTimers = {
  ...timers,
  setTimeout: (handler: () => void) => {
    handler()
    return 0
  },
}

const remoteCallsOf = (): RemoteCalls =>
  new RemoteCalls({
    sessionId: SESSION,
    token: 'token',
    connector: async () => {
      throw new Error('the probe append never reaches the sandbox')
    },
    timers,
    onFenced: () => {},
  })

const openRecord = async (args: {
  pictures?: PictureStore | undefined
  timers?: HostTimers | undefined
}): Promise<SessionRecord> => {
  const plane = new ControlPlane({ store: new InMemoryControlStore({ clock: () => AT }) })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: THREAD,
  })
  const { epoch } = await plane.grant({ sessionId: SESSION, hostId: 1 })
  return SessionRecord.open({
    plane,
    threadId: THREAD,
    epoch,
    timers: args.timers ?? timers,
    remoteCalls: remoteCallsOf(),
    daemonTools: new Set<string>(),
    nowIso: () => AT,
    ...(args.pictures === undefined ? {} : { pictures: args.pictures }),
  })
}

const storedPicturesOf = (): {
  calls: { bytes: Uint8Array; mediaType: string }[]
  store: PictureStore
} => {
  const calls: { bytes: Uint8Array; mediaType: string }[] = []
  return {
    calls,
    store: {
      store: async (args) => {
        calls.push({ bytes: args.bytes, mediaType: args.mediaType })
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

describe('storePictures', () => {
  it('replaces an inline picture with a media part and keeps its source', async () => {
    const { calls, store } = storedPicturesOf()
    const body = await storePictures({
      body: toolResultWith({
        type: 'image',
        bytes: { kind: 'inline', data: PNG },
        mediaType: 'image/png',
        source: 'screenshot.png',
      }),
      pictures: store,
      timers,
    })

    expect(calls).toEqual([{ bytes: Buffer.from(PNG, 'base64'), mediaType: 'image/png' }])
    expect(body.type === 'tool-result' ? body.modelParts : undefined).toEqual([
      { type: 'media', media: MEDIA, source: 'screenshot.png' },
    ])
  })

  it('keeps no bytes but says so when no store is wired', async () => {
    const body = toolResultWith({
      type: 'image',
      bytes: { kind: 'inline', data: PNG },
      mediaType: 'image/png',
    })
    const stored = await storePictures({ body, timers })

    expect(stored.type === 'tool-result' ? stored.modelParts : undefined).toEqual([
      { type: 'text', text: '[picture not kept: no picture store: image/png]' },
    ])
  })

  it('names the picture when the store refuses it', async () => {
    const body = toolResultWith({
      type: 'image',
      bytes: { kind: 'inline', data: PNG },
      mediaType: 'image/png',
      source: 'shot.png',
    })
    const stored = await storePictures({ body, timers, pictures: { store: async () => null } })

    expect(stored.type === 'tool-result' ? stored.modelParts : undefined).toEqual([
      { type: 'text', text: '[picture not kept: refused by the store: shot.png]' },
    ])
  })

  it('keeps no bytes when the store throws', async () => {
    const body = toolResultWith({
      type: 'image',
      bytes: { kind: 'inline', data: PNG },
      mediaType: 'image/png',
    })
    const stored = await storePictures({
      body,
      timers,
      pictures: {
        store: async () => {
          throw new Error('blob is down')
        },
      },
    })

    expect(stored.type === 'tool-result' ? stored.modelParts : undefined).toEqual([
      { type: 'text', text: '[picture not kept: the store failed: image/png]' },
    ])
  })

  it('leaves a body that is not a tool result alone', async () => {
    const body = {
      type: 'assistant-said',
      parts: [{ type: 'text', text: 'done' }],
    } as never

    expect(await storePictures({ body, timers, pictures: storedPicturesOf().store })).toBe(body)
  })

  it('stops waiting on a store that outlasts its deadline and aborts it', async () => {
    const body = toolResultWith({
      type: 'image',
      bytes: { kind: 'inline', data: PNG },
      mediaType: 'image/png',
    })
    const signals: AbortSignal[] = []
    const stored = await storePictures({
      body,
      timers: expiringTimers,
      timeoutMs: 15_000,
      pictures: {
        store: ({ signal }) => {
          signals.push(signal)
          return new Promise<MediaRef | null>(() => undefined)
        },
      },
    })

    expect(stored.type === 'tool-result' ? stored.modelParts : undefined).toEqual([
      { type: 'text', text: '[picture not kept: the store timed out: image/png]' },
    ])
    expect(signals.map((signal) => signal.aborted)).toEqual([true])
  })
})

describe('SessionRecord pictures', () => {
  it('commits the tool result when the store never settles', async () => {
    const record = await openRecord({
      pictures: { store: () => new Promise<MediaRef | null>(() => undefined) },
      timers: expiringTimers,
    })

    await record.append({
      threadId: THREAD,
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
    expect(event?.type).toBe('tool-result')
    expect(
      event !== undefined && event.type === 'tool-result' ? event.modelParts : undefined,
    ).toEqual([{ type: 'text', text: '[picture not kept: the store timed out: image/png]' }])
  })

  it('commits the tool result with the media part and no inline bytes', async () => {
    const { calls, store } = storedPicturesOf()
    const record = await openRecord({ pictures: store })

    await record.append({
      threadId: THREAD,
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
