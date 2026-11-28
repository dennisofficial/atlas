import { describe, expect, it } from 'bun:test'

import { EHeldAction, type InboxEntry } from '@dltech/atlas-core'
import { EFirstAction } from '@dltech/atlas-observability'

import { ranQueuedCommand } from '../held-runner'
import type { TakeOverFirstStep } from '../held-takeover'

const POSTED = '2026-11-28T02:53:40.028Z'

const entryOf = (kind: string): InboxEntry => ({
  sessionId: 's',
  inboxId: 10,
  kind,
  payload: '{}',
  postedAt: POSTED,
  consumedSeq: null,
  threadId: null,
  senderSessionId: null,
})

const WAITING = { promptWaiting: false, preparedBefore: true }

const runWith = async (args: {
  entries: readonly InboxEntry[]
  turnRunning?: boolean
}): Promise<TakeOverFirstStep[]> => {
  const steps: TakeOverFirstStep[] = []
  await ranQueuedCommand({
    action: EHeldAction.Wait,
    entries: args.entries,
    turnRunning: args.turnRunning ?? false,
    runCommands: async () => true,
    waiting: WAITING,
    firstStep: (step) => steps.push(step),
  })
  return steps
}

describe('ranQueuedCommand first step', () => {
  it('reports a command as the take-over first step, timed from its post', async () => {
    expect(await runWith({ entries: [entryOf('command:summarise')] })).toEqual([
      { action: EFirstAction.Command, ...WAITING, queuedAt: POSTED },
    ])
  })

  it('reports nothing without a command or while a turn runs', async () => {
    expect(await runWith({ entries: [entryOf('message')] })).toEqual([])
    expect(await runWith({ entries: [entryOf('command:summarise')], turnRunning: true })).toEqual(
      [],
    )
  })
})
