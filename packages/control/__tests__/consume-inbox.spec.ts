import { describe, expect, it } from 'bun:test'
import { GENESIS_HASH, type InboxEntry } from '@dltech/atlas-core'

import { consumeInbox } from '../src/consume-inbox'
import { InMemoryControlStore } from '../src/testing/memory'
import type { ControlTx } from '../src/port'
import { AppendAbort } from '../src/refusal'

const SESSION = 'session-1'
const head = { seq: 0, hash: GENESIS_HASH }
const entry: InboxEntry = {
  sessionId: SESSION,
  inboxId: 1,
  kind: 'user',
  payload: '"a"',
  postedAt: '2026-11-02T12:00:00.000Z',
  consumedSeq: null,
  senderSessionId: null,
}

const raceOn = (params: { tx: ControlTx; beforeMarkFails: () => Promise<void> }): ControlTx =>
  Object.create(params.tx, {
    markInboxConsumed: {
      value: async () => {
        await params.beforeMarkFails()
        return false
      },
    },
  })

async function refusalOf(params: { race: (tx: ControlTx) => Promise<void> }) {
  const store = new InMemoryControlStore()
  return store.transact(async (tx) => {
    await tx.createSession({
      sessionId: SESSION,
      userId: 'user-1',
      projectId: 'project-1',
      mainThreadId: 'thread-1',
      at: entry.postedAt,
    })
    await tx.insertInboxEntry(entry)
    const racing = raceOn({ tx, beforeMarkFails: () => params.race(tx) })
    try {
      await consumeInbox({ tx: racing, sessionId: SESSION, inboxId: 1, seq: 1, head })
    } catch (error) {
      if (error instanceof AppendAbort) return error.refusal
      throw error
    }
    return undefined
  })
}

describe('consumeInbox when the mark loses a race', () => {
  it('reports unknown-inbox-entry when a take-back deleted the entry', async () => {
    const refusal = await refusalOf({
      race: async (tx) => {
        await tx.deleteInboxEntry({ sessionId: SESSION, inboxId: 1 })
      },
    })
    expect(refusal).toEqual({ kind: 'unknown-inbox-entry' })
  })

  it('reports already-consumed when another writer consumed the entry', async () => {
    const refusal = await refusalOf({
      race: async (tx) => {
        await tx.markInboxConsumed({ sessionId: SESSION, inboxId: 1, seq: 9 })
      },
    })
    expect(refusal).toEqual({ kind: 'already-consumed' })
  })
})
