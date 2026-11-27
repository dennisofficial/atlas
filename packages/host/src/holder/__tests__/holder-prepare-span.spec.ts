import { describe, expect, it } from 'bun:test'

import { EWorkspaceStep, EWorkspaceStepState } from '@dltech/atlas-core'
import { EPrepareOutcome, EPreparePhase, ESandboxStart, ESpan } from '@dltech/atlas-observability'
import { RecordingTracer } from '@dltech/atlas-observability/testing'

import { PrepareSpan } from '../prepare-span'
import { FakeClock, flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

const prepareSpanEnded = (trace: RecordingTracer): boolean =>
  trace.named(ESpan.Prepare).some((span) => span.ended)

describe('holder.prepare span', () => {
  it('times one prepare attempt with its steps, sandbox and outcome', async () => {
    const trace = new RecordingTracer()
    const clock = new FakeClock()
    const rig = await makeRig({
      trace,
      clock,
      prepare: async (onStep) => {
        onStep?.({ step: EWorkspaceStep.Sandbox, state: EWorkspaceStepState.Started })
        clock.advance(40)
        onStep?.({ step: EWorkspaceStep.Sandbox, state: EWorkspaceStepState.Done })
        onStep?.({ step: EWorkspaceStep.Clone, state: EWorkspaceStepState.Started })
        clock.advance(15)
        onStep?.({ step: EWorkspaceStep.Clone, state: EWorkspaceStepState.Done })
        return { ok: true }
      },
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.wake()
    const ended = await flushUntil({ check: () => prepareSpanEnded(trace) })
    expect(ended).toBe(true)

    const [span] = trace.named(ESpan.Prepare)
    expect(span?.parent).toBeUndefined()
    expect(span?.fields.sessionId).toBe(SESSION)
    expect(span?.fields.threadId).toBe(THREAD_ID)
    expect(span?.fields.attempt).toBe(1)
    expect(span?.fields.preparedBefore).toBe(false)
    expect(span?.fields.sandbox).toBe(ESandboxStart.Unknown)
    expect(span?.fields.outcome).toBe(EPrepareOutcome.Prepared)
    expect(span?.fields.timings).toEqual({
      sandbox: 40,
      clone: 15,
      steps: 0,
      seed: 0,
      record: 0,
      setupEnd: 0,
      prepare: 55,
    })
  })

  it('times the steps from when their reports were produced, not when the span subscribed', async () => {
    const trace = new RecordingTracer()
    const span = new PrepareSpan({
      trace,
      sessionId: SESSION,
      threadId: THREAD_ID,
      attempt: 1,
      preparedBefore: false,
      promptWaiting: false,
      now: () => 1_000,
    })
    span.step({ step: EWorkspaceStep.Sandbox, state: EWorkspaceStepState.Started }, 100)
    span.step({ step: EWorkspaceStep.Sandbox, state: EWorkspaceStepState.Done }, 300)
    span.step({ step: EWorkspaceStep.Clone, state: EWorkspaceStepState.Started }, 300)
    span.step({ step: EWorkspaceStep.Clone, state: EWorkspaceStepState.Done }, 400)
    await span.begin(async () => ({ failed: false }))

    const [recorded] = trace.named(ESpan.Prepare)
    expect(recorded?.fields.timings).toEqual({ sandbox: 200, clone: 100, prepare: 900 })
  })

  it('times a step from its first start report when progress reports repeat it', async () => {
    const trace = new RecordingTracer()
    const span = new PrepareSpan({
      trace,
      sessionId: SESSION,
      threadId: THREAD_ID,
      attempt: 1,
      preparedBefore: false,
      promptWaiting: true,
      now: () => 9_000,
    })
    span.step({ step: EWorkspaceStep.Clone, state: EWorkspaceStepState.Started }, 1_000)
    span.step({ step: EWorkspaceStep.Clone, state: EWorkspaceStepState.Started }, 1_100)
    span.step({ step: EWorkspaceStep.Clone, state: EWorkspaceStepState.Started }, 8_400)
    span.step({ step: EWorkspaceStep.Clone, state: EWorkspaceStepState.Done }, 9_000)
    await span.begin(async () => ({ failed: false }))

    const [recorded] = trace.named(ESpan.Prepare)
    expect(recorded?.fields.timings).toEqual({ clone: 8_000, prepare: 8_000 })
  })

  it('attributes a step reported only when done to the wait since the last closed step', async () => {
    const trace = new RecordingTracer()
    const span = new PrepareSpan({
      trace,
      sessionId: SESSION,
      threadId: THREAD_ID,
      attempt: 1,
      preparedBefore: false,
      promptWaiting: true,
      now: () => 1_000,
    })
    span.step({ step: EWorkspaceStep.Sandbox, state: EWorkspaceStepState.Started }, 100)
    span.step({ step: EWorkspaceStep.Sandbox, state: EWorkspaceStepState.Done }, 140)
    span.step({ step: EWorkspaceStep.Daemon, state: EWorkspaceStepState.Done }, 900)
    await span.begin(async () => ({ failed: false }))

    const [recorded] = trace.named(ESpan.Prepare)
    expect(recorded?.fields.timings).toEqual({ sandbox: 40, daemon: 760, prepare: 900 })
  })

  it('times the holder phases around the attempt', async () => {
    const trace = new RecordingTracer()
    let now = 100
    const span = new PrepareSpan({
      trace,
      sessionId: SESSION,
      threadId: THREAD_ID,
      attempt: 1,
      preparedBefore: true,
      promptWaiting: undefined,
      now: () => now,
    })
    span.step({ step: EWorkspaceStep.Sandbox, state: EWorkspaceStepState.Started }, 100)
    span.step({ step: EWorkspaceStep.Sandbox, state: EWorkspaceStepState.Done }, 140)
    now = 140
    await span.begin(async () => {
      const stopSeed = span.phase(EPreparePhase.Seed)
      now = 390
      stopSeed()
      const stopRecord = span.phase(EPreparePhase.Record)
      now = 400
      stopRecord()
      return { failed: false }
    })

    const [recorded] = trace.named(ESpan.Prepare)
    expect(recorded?.fields.timings).toEqual({
      sandbox: 40,
      seed: 250,
      record: 10,
      prepare: 300,
    })
  })

  it('reports a failed attempt', async () => {
    const trace = new RecordingTracer()
    const rig = await makeRig({
      trace,
      prepare: async () => ({ ok: false, reason: 'clone failed' }),
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.wake()
    const ended = await flushUntil({ check: () => prepareSpanEnded(trace) })
    expect(ended).toBe(true)

    const spans = trace.named(ESpan.Prepare)
    expect(spans).toHaveLength(1)
    expect(spans[0]?.fields.outcome).toBe(EPrepareOutcome.Failed)
  })

  it('reports a stopped attempt over the failure it ends with', async () => {
    const trace = new RecordingTracer()
    const span = new PrepareSpan({
      trace,
      sessionId: SESSION,
      threadId: THREAD_ID,
      attempt: 2,
      preparedBefore: true,
      promptWaiting: true,
      now: () => 0,
    })
    span.markStopped()
    const outcome = await span.begin(async () => ({ failed: true }))

    expect(outcome).toEqual({ failed: true })
    const [recorded] = trace.named(ESpan.Prepare)
    expect(recorded?.fields.attempt).toBe(2)
    expect(recorded?.fields.preparedBefore).toBe(true)
    expect(recorded?.fields.promptWaiting).toBe(true)
    expect(recorded?.fields.outcome).toBe(EPrepareOutcome.Stopped)
  })
})
