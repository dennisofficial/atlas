import { describe, expect, it } from 'bun:test'

import { toThreadId, type ForkEvent, type OrphanedInput } from '@dltech/atlas-core'

import { createForkReconciler } from '../serve-fork-reconcile'
import { EServeEvent, type ServeLogLine } from '../serve-log'

const threadId = toThreadId('thread-reconcile')

const said = (args: { seq: number; text: string; requestId: string }): ForkEvent => ({
  seq: args.seq,
  type: 'user-said',
  body: { type: 'user-said', text: args.text, requestId: args.requestId },
})

const build = (args: { remote: ForkEvent[]; local: ForkEvent[] }) => {
  const steps: string[] = []
  const redelivered: OrphanedInput[] = []
  const lines: ServeLogLine[] = []
  const tails: number[] = []
  const reconciler = createForkReconciler({
    threadId,
    readRemoteTail: async ({ fromSeq }) => {
      tails.push(fromSeq)
      steps.push('read-remote')
      return args.remote
    },
    readLocal: async () => {
      steps.push('read-local')
      return args.local
    },
    redeliver: async (input) => {
      steps.push('redeliver')
      redelivered.push(input)
    },
    log: (line) => lines.push(line),
  })
  return { reconciler, steps, redelivered, lines, tails }
}

describe('createForkReconciler', () => {
  it('redelivers each orphaned input in remote order and logs the outcome', async () => {
    const run = build({
      remote: [
        said({ seq: 466, text: 'one', requestId: 'A' }),
        { seq: 467, type: 'pr-event', body: {} },
        said({ seq: 468, text: 'two', requestId: 'B' }),
      ],
      local: [said({ seq: 466, text: 'pod', requestId: 'X' })],
    })

    await run.reconciler.reconcile({ forkSeq: 466 })

    expect(run.tails).toEqual([466])
    expect(run.redelivered.map((input) => input.requestId)).toEqual(['A', 'B'])
    expect(run.lines).toEqual([
      {
        event: EServeEvent.EventForkReconciled,
        threadId,
        forkSeq: 466,
        redelivered: 2,
        discarded: [{ seq: 467, type: 'pr-event' }],
      },
    ])
  })

  it('redelivers nothing when every remote input already landed locally', async () => {
    const run = build({
      remote: [said({ seq: 466, text: 'one', requestId: 'A' })],
      local: [said({ seq: 470, text: 'one', requestId: 'A' })],
    })

    await run.reconciler.reconcile({ forkSeq: 466 })

    expect(run.redelivered).toEqual([])
    expect(run.lines[0]).toMatchObject({ redelivered: 0 })
  })

  it('does not log a reconcile when a redelivery fails, so the next conflict re-runs it', async () => {
    const lines: ServeLogLine[] = []
    const reconciler = createForkReconciler({
      threadId,
      readRemoteTail: async () => [said({ seq: 466, text: 'one', requestId: 'A' })],
      readLocal: async () => [],
      redeliver: async () => {
        throw new Error('the session is paused for a workspace handoff')
      },
      log: (line) => lines.push(line),
    })

    await expect(reconciler.reconcile({ forkSeq: 466 })).rejects.toThrow('paused')
    expect(lines).toEqual([])
  })
})
