import { describe, expect, it } from 'bun:test'
import { toRunId, toThreadId, type Event, type LoopState } from '@dltech/atlas-core'
import { ESpan } from '@dltech/atlas-observability'
import { RecordingTracer } from '@dltech/atlas-observability/testing'

import { AgentRecordPort } from '../../record/agent-record.port'
import { TracedRecord } from '../traced-record'

const THREAD = toThreadId('thread-1')

const EMPTY_STATE: LoopState = {
  empty: true,
  lastSeq: undefined,
  pending: [],
  dispatched: new Set(),
  approvals: new Map(),
  parked: new Map(),
  lastTurnType: undefined,
  lastAssistant: undefined,
  cutShortSincePrompt: false,
  stoppedSincePrompt: false,
  lastUserSaidSeq: undefined,
  worktree: undefined,
  home: undefined,
}

class StubRecord extends AgentRecordPort {
  appends = 0
  reads = 0

  async append(): Promise<Event[]> {
    this.appends += 1
    return []
  }

  async ownEvents(): Promise<Event[]> {
    this.reads += 1
    return []
  }

  async composedEvents(): Promise<Event[]> {
    this.reads += 1
    return []
  }

  async loopState(): Promise<LoopState> {
    this.reads += 1
    return EMPTY_STATE
  }
}

const setup = () => {
  const trace = new RecordingTracer()
  const inner = new StubRecord()
  return { trace, inner, record: new TracedRecord({ inner, trace }) }
}

describe('TracedRecord', () => {
  it('spans an append, which is the write that costs real time', async () => {
    const { trace, inner, record } = setup()

    await trace.span({
      name: ESpan.Turn,
      root: true,
      run: () => record.append({ threadId: THREAD, runId: toRunId('run-1'), drafts: [] }),
    })

    expect(inner.appends).toBe(1)
    expect(trace.named(ESpan.RecordAppend)).toHaveLength(1)
  })

  it('reads straight through without a span', async () => {
    const { trace, inner, record } = setup()

    await trace.span({
      name: ESpan.Turn,
      root: true,
      run: async () => {
        await record.ownEvents({ threadId: THREAD })
        await record.composedEvents({ threadId: THREAD })
        await record.loopState({ threadId: THREAD })
      },
    })

    expect(inner.reads).toBe(3)
    expect(trace.named(ESpan.RecordRead)).toEqual([])
    expect(trace.named(ESpan.Turn)).toHaveLength(1)
  })
})
