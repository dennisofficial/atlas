import { describe, expect, it } from 'bun:test'

import {
  EMessageOrigin,
  EReportKind,
  inboxEventOf,
  TEAMMATE_AGENT_TYPE,
  type InboxEntry,
} from '@dltech/atlas-core'

import { ControlPlane, MessageOriginRequiredError } from '../src'
import { InMemoryControlStore } from '../src/testing/memory'

const NOW = '2026-11-18T12:00:00.000Z'
const SPAWNER = 'session-spawner'
const TEAMMATE = 'session-teammate'
const SPAWNER_THREAD = 'thread-spawner'
const TEAMMATE_THREAD = 'thread-teammate'

const setup = async () => {
  const store = new InMemoryControlStore({ clock: () => NOW })
  const plane = new ControlPlane({ store, clock: () => NOW })
  await plane.createSession({
    sessionId: SPAWNER,
    userId: 'user-a',
    projectId: 'project-a',
    mainThreadId: SPAWNER_THREAD,
    title: 'Ship the parser',
  })
  await plane.spawnPeer({
    spawnerSessionId: SPAWNER,
    sessionId: TEAMMATE,
    mainThreadId: TEAMMATE_THREAD,
    title: 'Lexer rewrite',
    nested: true,
  })
  return { store, plane }
}

const inboxOf = async (args: { plane: ControlPlane; sessionId: string }): Promise<InboxEntry[]> =>
  args.plane.readInbox({ sessionId: args.sessionId, afterId: 0, limit: 20 })

describe('a teammate reporting to its spawner', () => {
  it('posts an agent-reported event naming the teammate, not a message from anyone', async () => {
    const { plane } = await setup()

    const posted = await plane.reportToSpawner({
      sessionId: TEAMMATE,
      kind: EReportKind.Done,
      text: 'the lexer is rewritten',
    })

    const inbox = await inboxOf({ plane, sessionId: SPAWNER })
    expect(inbox).toHaveLength(1)
    expect(inbox[0]?.kind).toBe('event')
    expect(inbox[0]?.senderSessionId).toBe(TEAMMATE)

    const read = inboxEventOf(inbox[0]?.payload ?? '')
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.event).toMatchObject({
      type: 'agent-reported',
      agentId: TEAMMATE_THREAD,
      agentType: TEAMMATE_AGENT_TYPE,
      intent: 'Lexer rewrite',
      prose: 'the lexer is rewritten',
      kind: EReportKind.Done,
    })
    expect(posted).toEqual({ inboxId: 1 })
  })

  it('wakes the spawner only for a report that asks for it', async () => {
    const { store, plane } = await setup()
    const before = store.wakeCount(SPAWNER)

    await plane.reportToSpawner({
      sessionId: TEAMMATE,
      kind: EReportKind.Progress,
      text: 'still lexing',
    })

    expect(store.wakeCount(SPAWNER)).toBe(before)
  })
})

describe('a message posted without an origin', () => {
  it('is refused at the write seam', async () => {
    const { plane } = await setup()
    await plane.spawnPeer({
      spawnerSessionId: SPAWNER,
      sessionId: 'session-other',
      mainThreadId: 'thread-other',
      nested: true,
    })

    await expect(
      plane.post({
        sessionId: 'session-other',
        kind: 'message',
        payload: JSON.stringify({ text: 'who is this' }),
      }),
    ).rejects.toThrow(MessageOriginRequiredError)
    expect(await inboxOf({ plane, sessionId: 'session-other' })).toHaveLength(0)
  })

  it('is refused when the payload names no origin and does not read as a message', async () => {
    const { plane } = await setup()

    await expect(
      plane.post({ sessionId: SPAWNER, kind: 'message', payload: 'not json' }),
    ).rejects.toThrow(MessageOriginRequiredError)
  })

  it('is allowed once the sender names an origin', async () => {
    const { plane } = await setup()

    const posted = await plane.messagePeer({
      fromSessionId: SPAWNER,
      toSessionId: TEAMMATE,
      text: 'tighten the tokenizer',
    })

    const inbox = await inboxOf({ plane, sessionId: TEAMMATE })
    expect(JSON.parse(inbox[0]?.payload ?? '{}')).toEqual({
      text: 'tighten the tokenizer',
      via: EMessageOrigin.PeerAgent,
    })
    expect(inbox[0]?.senderSessionId).toBe(SPAWNER)
    expect(posted).toEqual({ inboxId: 1 })
  })
})
