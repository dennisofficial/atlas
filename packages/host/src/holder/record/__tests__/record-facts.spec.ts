import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import {
  ECompactionAnchor,
  chainEvents,
  toRunId,
  toThreadId,
  type LogHead,
  type RecordEventBody,
} from '@dltech/atlas-core'

import { RecordCache } from '../record-cache'
import { factsOfKindIn } from '../record-facts'

const SESSION = 'session-1'
const THREAD = toThreadId('thread-1')
const AT = '2026-11-25T12:00:00.000Z'

type FactBody = Extract<RecordEventBody, { type: 'fact-recorded' }>

const PLACEMENT: FactBody = {
  type: 'fact-recorded',
  key: 'upload:0b9f3c1e-5d2a-4c8e-9a41-7e6d2f8b1a30',
  kind: 'upload-placement',
  value: { state: 'ready', path: '/atlas/home/uploads/a/a.sh' },
}

const openThread = async (): Promise<{ plane: ControlPlane; epoch: number }> => {
  const plane = new ControlPlane({ store: new InMemoryControlStore({ clock: () => AT }) })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: THREAD,
  })
  const { epoch } = await plane.grant({ sessionId: SESSION, hostId: 1 })
  return { plane, epoch }
}

const appendTo = async (args: {
  plane: ControlPlane
  epoch: number
  bodies: readonly RecordEventBody[]
}): Promise<{ head: LogHead; events: ReturnType<typeof chainEvents> }> => {
  const from = await args.plane.head({ threadId: THREAD })
  const events = chainEvents({
    threadId: THREAD,
    runId: toRunId('run-1'),
    epoch: args.epoch,
    at: AT,
    bodies: args.bodies,
    from,
  })
  const outcome = await args.plane.append({ threadId: THREAD, epoch: args.epoch, events })
  if (!outcome.ok) throw new Error(`append refused: ${JSON.stringify(outcome.refusal)}`)
  return { head: outcome.head, events }
}

const anchorEvent = (throughSeq: number): RecordEventBody => ({
  type: 'history-summarised',
  fromSeq: 1,
  throughSeq,
  anchor: ECompactionAnchor.Prefix,
  summary: 'the opening work',
})

describe('fact-recorded in the record cache', () => {
  it('reads back every fact of the kind asked for, and no other kind', async () => {
    const { plane, epoch } = await openThread()
    await appendTo({
      plane,
      epoch,
      bodies: [
        { type: 'user-said', text: 'run the attached script' },
        PLACEMENT,
        { type: 'fact-recorded', key: 'base:/w', kind: 'base', value: 'abc123' },
      ],
    })

    const cache = await RecordCache.load({ plane, threadId: THREAD })

    expect(factsOfKindIn({ cache, kind: 'upload-placement' })).toEqual([
      {
        type: 'fact-recorded',
        key: PLACEMENT.key,
        kind: 'upload-placement',
        value: { state: 'ready', path: '/atlas/home/uploads/a/a.sh' },
      },
    ])
  })

  it('keeps a placement fact readable after a summary hides its message', async () => {
    const { plane, epoch } = await openThread()
    await appendTo({
      plane,
      epoch,
      bodies: [{ type: 'user-said', text: 'run the attached script' }, PLACEMENT, anchorEvent(2)],
    })

    const cache = await RecordCache.load({ plane, threadId: THREAD })

    expect(factsOfKindIn({ cache, kind: 'upload-placement' })).toHaveLength(1)
  })
})
