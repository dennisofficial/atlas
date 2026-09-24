import {
  stampEvent,
  toThreadId,
  toCallId,
  toEventId,
  toRunId,
  type Event,
  type EventDraft,
} from '@dltech/atlas-core'
import { LocalRewindMachinery } from '@dltech/atlas-harness'
import { describe, expect, it } from 'bun:test'

import { discardInterrupted, EDiscard } from '../resume-turn'
import { fakeAgentRegistry } from './fake-agents'
import { fakeShellRegistry } from './fake-app'
import { fakeThreadStore, fakeEventLog } from './fake-backend'
import { fakeServiceRegistry } from './fake-services'

const THREAD = toThreadId('resuming')

const AT = '2026-08-25T00:00:00.000Z'

const stamped = (drafts: readonly EventDraft[]): Event[] =>
  drafts.map((draft, index) =>
    stampEvent({
      draft,
      envelope: {
        id: toEventId(`event-${index + 1}`),
        seq: index + 1,
        threadId: THREAD,
        runId: toRunId('run-1'),
        depth: 0,
        at: AT,
      },
    }),
  )

const backedBy = (drafts: readonly EventDraft[]) => {
  const log = fakeEventLog(stamped(drafts))
  const registries = {
    agents: fakeAgentRegistry(),
    shells: fakeShellRegistry(),
    services: fakeServiceRegistry(),
  }
  return {
    log,
    threads: fakeThreadStore({ log, existing: [THREAD] }),
    machinery: new LocalRewindMachinery(registries),
  }
}

describe('discarding a cut-short reply so the step can be taken again', () => {
  it('deletes the interrupted reply and leaves the message that asked for it', async () => {
    const { log, threads, machinery } = backedBy([
      { type: 'user-said', text: 'explain the loop' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'it keeps' }], interrupted: true },
    ])

    const discarded = await discardInterrupted({ log, threads, machinery, threadId: THREAD })

    expect(discarded).toEqual({ type: EDiscard.Discarded })
    expect((await log.read({ threadId: THREAD })).map((event) => event.type)).toEqual(['user-said'])
  })

  it('leaves a thread the model finished alone', async () => {
    const { log, threads, machinery } = backedBy([
      { type: 'user-said', text: 'explain the loop' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'it keeps its position' }] },
    ])

    expect(await discardInterrupted({ log, threads, machinery, threadId: THREAD })).toEqual({
      type: EDiscard.Nothing,
    })
    expect(await log.read({ threadId: THREAD })).toHaveLength(2)
  })

  it('discards nothing when the interruption left a tool settlement as the last word', async () => {
    const { log, threads, machinery } = backedBy([
      { type: 'user-said', text: 'run it' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'running' }], interrupted: true },
      { type: 'tool-called', callId: toCallId('call-1'), name: 'bash', input: {}, ordinal: 0 },
      { type: 'tool-denied', callId: toCallId('call-1'), name: 'bash', reason: 'stopped first' },
    ])

    expect(await discardInterrupted({ log, threads, machinery, threadId: THREAD })).toEqual({
      type: EDiscard.Nothing,
    })
    expect(await log.read({ threadId: THREAD })).toHaveLength(4)
  })
})
