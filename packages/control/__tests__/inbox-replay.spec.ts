import { describe, expect, it } from 'bun:test'

import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import { EMessageOrigin, INBOX_KIND_EVENT, toThreadId } from '@dltech/atlas-core'
import { INBOX_KIND_MESSAGE } from '@dltech/atlas-protocol'

import { ControlPlane } from '../src/control-plane'
import { INBOX_IDEMPOTENCY_LOOKBACK } from '../src/inbox-ops'

const SESSION = 'session-1'
const PEER = 'session-peer'
const THREAD = toThreadId('thread-1')
const AT = '2026-11-26T10:00:00.000Z'

const rigOf = async () => {
  const plane = new ControlPlane({
    store: new InMemoryControlStore({ clock: () => AT }),
    clock: () => AT,
  })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: THREAD,
  })
  return plane
}

const messageOf = (text: string, clientId: string): string =>
  JSON.stringify({ text, via: EMessageOrigin.Operator, clientId })

const postMessageOf =
  (plane: ControlPlane, sessionId: string) =>
  async (args: { text: string; clientId: string; replayed?: boolean | undefined }) =>
    await plane.post({
      sessionId,
      kind: INBOX_KIND_MESSAGE,
      payload: messageOf(args.text, args.clientId),
      ...(args.replayed === undefined ? {} : { replayed: args.replayed }),
    })

const postedWith = async (plane: ControlPlane, sessionId: string, clientId: string) => {
  const entries = await plane.readInbox({ sessionId, afterId: 0, limit: 1000 })
  return entries.filter((entry) => entry.payload.includes(`"${clientId}"`))
}

const bury = async (plane: ControlPlane, sessionId: string): Promise<void> => {
  for (let index = 0; index < INBOX_IDEMPOTENCY_LOOKBACK + 10; index += 1)
    await postMessageOf(plane, sessionId)({ text: `filler ${index}`, clientId: `filler-${index}` })
}

describe('a client id posted again by a replay', () => {
  it('finds its entry past the recent window and posts nothing', async () => {
    const plane = await rigOf()
    const post = postMessageOf(plane, SESSION)
    const first = await post({ text: 'one', clientId: 'client-1' })
    await bury(plane, SESSION)
    const replayed = await post({ text: 'one', clientId: 'client-1', replayed: true })
    expect(replayed.inboxId).toBe(first.inboxId)
    expect(await postedWith(plane, SESSION, 'client-1')).toHaveLength(1)
  })

  it('posts a second copy when the call is not a replay, because the window forgot it', async () => {
    const plane = await rigOf()
    const post = postMessageOf(plane, SESSION)
    await post({ text: 'one', clientId: 'client-1' })
    await bury(plane, SESSION)
    await post({ text: 'one', clientId: 'client-1' })
    expect(await postedWith(plane, SESSION, 'client-1')).toHaveLength(2)
  })

  it('still drops a repeat inside the window without the replay flag', async () => {
    const plane = await rigOf()
    const post = postMessageOf(plane, SESSION)
    const first = await post({ text: 'one', clientId: 'client-1' })
    const again = await post({ text: 'one', clientId: 'client-1' })
    expect(again.inboxId).toBe(first.inboxId)
    expect(await postedWith(plane, SESSION, 'client-1')).toHaveLength(1)
  })
})

describe('a spawn brief posted again over the session it already made', () => {
  it('delivers the brief once, past the recent window', async () => {
    const plane = await rigOf()
    const spawn = async () =>
      await plane.spawnPeer({
        spawnerSessionId: SESSION,
        sessionId: PEER,
        mainThreadId: 'thread-peer',
        brief: 'read the port',
        clientId: 'client-1',
      })
    const first = await spawn()
    await bury(plane, PEER)
    const again = await spawn()
    expect(again).toEqual(first)
    expect(await postedWith(plane, PEER, 'client-1')).toHaveLength(1)
  })

  it('refuses a spawn whose session another spawner already made', async () => {
    const plane = await rigOf()
    await plane.createSession({
      sessionId: 'session-other',
      userId: 'user-1',
      projectId: 'project-1',
      mainThreadId: toThreadId('thread-other'),
    })
    await plane.spawnPeer({
      spawnerSessionId: 'session-other',
      sessionId: PEER,
      mainThreadId: 'thread-peer',
      brief: 'read the port',
      clientId: 'client-1',
    })
    const refused = await plane.spawnPeer({
      spawnerSessionId: SESSION,
      sessionId: PEER,
      mainThreadId: 'thread-peer',
      brief: 'read the port',
      clientId: 'client-1',
    })
    expect(refused).toEqual({ refused: `the session ${PEER} already exists` })
  })
})

describe('an event whose client id the inbox already holds', () => {
  it('answers with the entry it found rather than a second one', async () => {
    const plane = await rigOf()
    const payload = JSON.stringify({
      version: 1,
      event: { type: 'nudge', text: 'x' },
      clientId: 'c',
    })
    const first = await plane.post({ sessionId: SESSION, kind: INBOX_KIND_EVENT, payload })
    await bury(plane, SESSION)
    const replayed = await plane.post({
      sessionId: SESSION,
      kind: INBOX_KIND_EVENT,
      payload,
      replayed: true,
    })
    expect(replayed.inboxId).toBe(first.inboxId)
  })
})
