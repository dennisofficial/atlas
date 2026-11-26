import { describe, expect, it } from 'bun:test'

import { INBOX_KIND_EVENT } from '@dltech/atlas-core'

import { ControlPlane } from '../src/control-plane'
import { INBOX_IDEMPOTENCY_LOOKBACK } from '../src/inbox-ops'
import { spawnBriefClientIdOf } from '../src/peer-sessions'
import { InMemoryControlStore } from '../src/testing/memory'

const T0 = '2026-11-26T10:00:00.000Z'
const SPAWNER = { sessionId: 's1', mainThreadId: 't1', userId: 'u1', projectId: 'p1' }
const PEER = { sessionId: 's2', mainThreadId: 't2', userId: 'u1', projectId: 'p1' }

const rig = async () => {
  const plane = new ControlPlane({
    store: new InMemoryControlStore({ clock: () => T0 }),
    clock: () => T0,
  })
  await plane.createSession(SPAWNER)
  await plane.createSession(PEER)
  return plane
}

const inboxOf = async (args: { plane: ControlPlane; sessionId: string }) =>
  args.plane.readInbox({ sessionId: args.sessionId, afterId: 0, limit: 1000 })

const fillInbox = async (args: { plane: ControlPlane; sessionId: string; count: number }) => {
  for (let n = 0; n < args.count; n++) {
    await args.plane.messagePeer({
      fromSessionId: SPAWNER.sessionId,
      toSessionId: args.sessionId,
      text: `later ${n}`,
      clientId: `later-${n}`,
    })
  }
}

describe('a keyed post is deduplicated by its receipt', () => {
  it('answers a replayed peer message with the inbox entry it made, however far back', async () => {
    const plane = await rig()
    const message = {
      fromSessionId: SPAWNER.sessionId,
      toSessionId: PEER.sessionId,
      text: 'one effect',
      clientId: 'call-1.0',
    }
    const first = await plane.messagePeer(message)
    await fillInbox({ plane, sessionId: PEER.sessionId, count: INBOX_IDEMPOTENCY_LOOKBACK + 10 })
    const replay = await plane.messagePeer(message)
    expect(replay).toEqual(first)
    expect(await inboxOf({ plane, sessionId: PEER.sessionId })).toHaveLength(
      INBOX_IDEMPOTENCY_LOOKBACK + 11,
    )
  })

  it('answers a replayed report with the inbox entry it made, however far back', async () => {
    const plane = await rig()
    await plane.spawnPeer({
      spawnerSessionId: SPAWNER.sessionId,
      sessionId: 'child',
      mainThreadId: 'tc',
    })
    const report = { sessionId: 'child', text: 'finished', clientId: 'call-2.0' }
    const first = await plane.reportToSpawner(report)
    if ('refused' in first) throw new Error(`the report was refused: ${first.refused}`)
    await fillInbox({ plane, sessionId: SPAWNER.sessionId, count: INBOX_IDEMPOTENCY_LOOKBACK + 10 })
    expect(await plane.reportToSpawner(report)).toEqual(first)
    expect(await inboxOf({ plane, sessionId: SPAWNER.sessionId })).toHaveLength(
      INBOX_IDEMPOTENCY_LOOKBACK + 11,
    )
  })

  it('answers a replayed spawn with the same brief, however far back', async () => {
    const plane = await rig()
    const spawn = {
      spawnerSessionId: SPAWNER.sessionId,
      sessionId: 'child',
      mainThreadId: 'tc',
      brief: 'do the work',
    }
    const first = await plane.spawnPeer(spawn)
    if (!('inboxId' in first)) throw new Error(`the spawn was refused: ${first.refused}`)
    await fillInbox({ plane, sessionId: 'child', count: INBOX_IDEMPOTENCY_LOOKBACK + 10 })
    expect(await plane.spawnPeer(spawn)).toEqual({ inboxId: first.inboxId, already: true })
    const inbox = await inboxOf({ plane, sessionId: 'child' })
    expect(inbox).toHaveLength(INBOX_IDEMPOTENCY_LOOKBACK + 11)
    expect(JSON.parse(inbox[0]?.payload ?? '{}')).toMatchObject({
      clientId: spawnBriefClientIdOf('child'),
      text: 'do the work',
    })
  })
})

describe('a notify key keeps the recent lookback', () => {
  it('posts the same notice once inside the lookback and again past it', async () => {
    const plane = await rig()
    const notice = {
      sessionId: PEER.sessionId,
      kind: INBOX_KIND_EVENT,
      payload: JSON.stringify({ clientId: 'service-ended:web', event: { type: 'service-ended' } }),
    }
    await plane.post(notice)
    await plane.post(notice)
    expect(await inboxOf({ plane, sessionId: PEER.sessionId })).toHaveLength(1)
    await fillInbox({ plane, sessionId: PEER.sessionId, count: INBOX_IDEMPOTENCY_LOOKBACK + 1 })
    await plane.post(notice)
    expect(await inboxOf({ plane, sessionId: PEER.sessionId })).toHaveLength(
      INBOX_IDEMPOTENCY_LOOKBACK + 3,
    )
  })
})
