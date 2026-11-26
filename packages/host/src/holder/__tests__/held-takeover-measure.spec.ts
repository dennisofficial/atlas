import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import { toThreadId } from '@dltech/atlas-core'
import { EFirstAction, ESpan, LogPort, type LogEntry } from '@dltech/atlas-observability'
import { RecordingTracer } from '@dltech/atlas-observability/testing'

import type { HeldSessionDeps } from '../held-session-deps'
import { TakeOver } from '../held-takeover'
import type { SessionRuntime } from '../ports'
import { FakeClock } from './rig-fakes'

const THREAD_ID = toThreadId('t-1')

class CollectingLog extends LogPort {
  readonly entries: LogEntry[] = []
  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

const takeoverLineOf = (log: CollectingLog): Record<string, unknown> | undefined =>
  log.entries.find(
    (entry) =>
      entry.source === 'holder.takeover' && entry.message.includes('reached its first step'),
  )?.data as Record<string, unknown> | undefined

const opened = async (): Promise<{
  takeOver: TakeOver
  trace: RecordingTracer
  log: CollectingLog
  clock: FakeClock
}> => {
  const clock = new FakeClock()
  const trace = new RecordingTracer()
  const log = new CollectingLog()
  const plane = new ControlPlane({
    store: new InMemoryControlStore({ clock: () => new Date(clock.now()).toISOString() }),
  })
  const runtime = {
    trace,
    remoteCalls: { releaseResize: () => {} },
    daemonTools: new Set<string>(),
  } as unknown as SessionRuntime
  const deps = {
    sessionId: 's-1',
    podSessionId: 's-1',
    plane,
    timers: clock,
    appendRetryMs: 0,
    drainCapMs: 0,
    runtimeFor: async () => runtime,
    log,
  } as unknown as HeldSessionDeps
  await plane.createSession({
    sessionId: 's-1',
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: THREAD_ID,
  })
  const takeOver = new TakeOver(deps, 0)
  await takeOver.open({
    threadId: THREAD_ID,
    epoch: 1,
    signal: new AbortController().signal,
    onLeaseLost: () => {},
    onRuntime: () => {},
  })
  return { takeOver, trace, log, clock }
}

describe('take-over measurement', () => {
  it('puts the first action and what was waiting on the take-over span and log', async () => {
    const { takeOver, trace, log } = await opened()
    takeOver.firstStep({
      action: EFirstAction.Prepare,
      promptWaiting: true,
      preparedBefore: false,
    })
    const [span] = trace.named(ESpan.Takeover)
    expect(span?.fields.firstAction).toBe(EFirstAction.Prepare)
    expect(span?.fields.promptWaiting).toBe(true)
    expect(span?.fields.preparedBefore).toBe(false)
    expect(takeoverLineOf(log)).toMatchObject({
      firstAction: EFirstAction.Prepare,
      promptWaiting: true,
      preparedBefore: false,
    })
  })

  it('marks a prompt posted before the claim and times its wait from the claim', async () => {
    const { takeOver, trace, log, clock } = await opened()
    clock.advance(500)
    takeOver.firstStep({
      action: EFirstAction.Turn,
      promptWaiting: true,
      preparedBefore: true,
      queuedAt: new Date(-2_000).toISOString(),
    })
    const [span] = trace.named(ESpan.Takeover)
    expect(span?.fields.promptAtClaim).toBe(true)
    expect(span?.fields.timings?.promptWait).toBe(500)
    expect(takeoverLineOf(log)).toMatchObject({ promptAtClaim: true, promptWaitMs: 500 })
  })

  it('times a prompt posted during the take-over from its post', async () => {
    const { takeOver, trace, clock } = await opened()
    clock.advance(90_000)
    takeOver.firstStep({
      action: EFirstAction.Turn,
      promptWaiting: true,
      preparedBefore: true,
      queuedAt: new Date(89_700).toISOString(),
    })
    const [span] = trace.named(ESpan.Takeover)
    expect(span?.fields.promptAtClaim).toBe(false)
    expect(span?.fields.timings?.promptWait).toBe(300)
    expect(span?.fields.timings?.firstStep).toBe(90_000)
  })

  it('leaves the prompt fields out when no prompt waited', async () => {
    const { takeOver, trace } = await opened()
    takeOver.firstStep({ action: EFirstAction.Turn, promptWaiting: false, preparedBefore: true })
    const [span] = trace.named(ESpan.Takeover)
    expect(span?.fields.promptAtClaim).toBeUndefined()
    expect(span?.fields.timings?.promptWait).toBeUndefined()
  })

  it('measures branches from the moment the observation started', async () => {
    const { takeOver, trace, clock } = await opened()
    clock.advance(100)
    takeOver.observationStarted()
    clock.advance(30)
    takeOver.branchesSettled()
    takeOver.firstStep({
      action: EFirstAction.Turn,
      promptWaiting: false,
      preparedBefore: true,
    })
    const [span] = trace.named(ESpan.Takeover)
    expect(span?.fields.timings?.branches).toBe(30)
    expect(span?.fields.timings?.firstStep).toBe(130)
  })

  it('measures branches from the take-over start when no observation started', async () => {
    const { takeOver, trace, clock } = await opened()
    clock.advance(70)
    takeOver.branchesSettled()
    takeOver.firstStep({
      action: EFirstAction.Turn,
      promptWaiting: false,
      preparedBefore: false,
    })
    const [span] = trace.named(ESpan.Takeover)
    expect(span?.fields.timings?.branches).toBe(70)
  })

  it('logs the turn start once when the first step was a prepare', async () => {
    const { takeOver, clock, log } = await opened()
    const turn = { action: EFirstAction.Turn, promptWaiting: true, preparedBefore: false }
    takeOver.firstStep({ action: EFirstAction.Prepare, promptWaiting: true, preparedBefore: false })
    clock.advance(45)
    takeOver.firstStep(turn)
    clock.advance(10)
    takeOver.firstStep(turn)
    const lines = log.entries.filter((entry) => entry.message.includes('started its turn'))
    expect(lines).toHaveLength(1)
    expect(lines[0]?.data).toMatchObject({ turnStartMs: 45 })
  })

  it('logs no separate turn start when the first step was the turn', async () => {
    const { takeOver, log } = await opened()
    takeOver.firstStep({ action: EFirstAction.Turn, promptWaiting: true, preparedBefore: true })
    const lines = log.entries.filter((entry) => entry.message.includes('started its turn'))
    expect(lines).toHaveLength(0)
  })
})
