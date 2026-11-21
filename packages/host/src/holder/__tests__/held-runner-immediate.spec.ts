import { describe, expect, it } from 'bun:test'
import { EHeldAction, type InboxEntry } from '@dltech/atlas-core'

import { ranImmediateCommands } from '../held-runner'

const entry: InboxEntry = {
  sessionId: 'ses_1',
  inboxId: 7,
  kind: 'command:subscribe',
  payload: '{}',
  postedAt: '2026-11-21T00:00:00.000Z',
  consumedSeq: null,
  threadId: null,
  senderSessionId: null,
}

const ranWith = async (args: { action: EHeldAction; turnRunning: boolean }) => {
  const seen: number[] = []
  const ran = await ranImmediateCommands({
    ...args,
    entries: [entry],
    runCommands: async (entries) => {
      seen.push(...entries.map((each) => each.inboxId))
      return true
    },
  })
  return { ran, seen }
}

describe('ranImmediateCommands', () => {
  it('runs during a turn', async () => {
    expect(await ranWith({ action: EHeldAction.Wait, turnRunning: true })).toEqual({
      ran: true,
      seen: [7],
    })
  })

  it('runs a logged command on an idle session before it waits or releases', async () => {
    for (const action of [EHeldAction.Wait, EHeldAction.Release, EHeldAction.StartTurn]) {
      expect((await ranWith({ action, turnRunning: false })).ran).toBe(true)
    }
  })

  it('leaves the command while the workspace prepares', async () => {
    expect(await ranWith({ action: EHeldAction.Prepare, turnRunning: false })).toEqual({
      ran: false,
      seen: [],
    })
  })
})
