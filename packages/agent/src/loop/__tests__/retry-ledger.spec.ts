import { describe, expect, it } from 'bun:test'

import { ERetryReason, saidBody, toRunId, type ModelPort } from '@dltech/atlas-core'

import { rigOf, THREAD } from '../../__tests__/exit-fixture'
import { InMemoryModelContext, InMemoryOnceLedger } from '../../testing'
import type { RetryNotice } from '../retrying-step'
import { ETurnStatus } from '../turn-outcome'

const seedMessage = async (rig: ReturnType<typeof rigOf>): Promise<void> => {
  await rig.record.append({
    threadId: THREAD,
    runId: toRunId('run-seed'),
    drafts: [saidBody({ text: 'hi' })],
  })
}

const fakeRetry = (args: { sleeps: number[]; notices?: RetryNotice[]; now: () => number }) => ({
  sleep: async ({ ms }: { ms: number; signal: AbortSignal }) => {
    args.sleeps.push(ms)
  },
  jitter: () => 0,
  now: args.now,
  ...(args.notices === undefined
    ? {}
    : { onWaiting: (notice: RetryNotice) => args.notices?.push(notice) }),
})

const resumeOn = (
  rig: ReturnType<typeof rigOf>,
  overrides: {
    record: ReturnType<typeof rigOf>['record']
    onceLedger: InMemoryOnceLedger
    retry: ReturnType<typeof fakeRetry>
    script: Parameters<typeof rigOf>[0]['script']
  },
) =>
  rigOf({
    script: overrides.script,
    overrides: {
      record: overrides.record,
      modelContext: new InMemoryModelContext(overrides.record),
      onceLedger: overrides.onceLedger,
      retry: overrides.retry,
    },
  })

const runFailedEvents = (rig: ReturnType<typeof rigOf>) =>
  rig.record.eventsOf(THREAD).filter((event) => String(event.type) === 'run-failed')

describe('retry deadlines through OnceLedger', () => {
  it('records retry:<thread>:s<base>:1 with notBefore = now + delay and sleeps exactly that', async () => {
    const ledger = new InMemoryOnceLedger()
    const sleeps: number[] = []
    const notices: RetryNotice[] = []
    const nowMs = 1_000_000
    const rig = rigOf({
      script: [{ throws: new Error('boom') }, { text: 'recovered' }],
      overrides: {
        onceLedger: ledger,
        retry: fakeRetry({ sleeps, notices, now: () => nowMs }),
      },
    })
    await seedMessage(rig)

    const outcome = await rig.runner.resume({ threadId: THREAD })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    const retries = await ledger.recallRetries({ prefix: `retry:${THREAD}:s0:` })
    expect(retries).toEqual([
      {
        key: `retry:${THREAD}:s0:1`,
        notBefore: new Date(nowMs + 500).toISOString(),
        attempt: 1,
        reason: ERetryReason.Network,
      },
    ])
    expect(sleeps).toEqual([500])
    expect(notices).toEqual([
      { attempt: 1, maxAttempts: 5, delayMs: 500, reason: ERetryReason.Network },
    ])
  })

  it('bases the step key on the last owned assistant-said', async () => {
    const ledger = new InMemoryOnceLedger()
    const nowMs = 1_500_000
    const rig = rigOf({
      script: [{ text: 'first answer' }, { throws: new Error('boom') }, { text: 'recovered' }],
      overrides: { onceLedger: ledger, retry: fakeRetry({ sleeps: [], now: () => nowMs }) },
    })
    await seedMessage(rig)
    const first = await rig.runner.resume({ threadId: THREAD })
    expect(first.status).toBe(ETurnStatus.Completed)
    const said = rig.record.eventsOf(THREAD).findLast((event) => event.type === 'assistant-said')
    if (said === undefined) throw new Error('no assistant-said')

    rig.intake.enqueue({ drafts: [saidBody({ text: 'again' })] })
    const second = await rig.runner.resume({ threadId: THREAD })

    expect(second.status).toBe(ETurnStatus.Completed)
    expect(ledger.has(`retry:${THREAD}:s${said.seq}:1`)).toBe(true)
  })

  it('a second runner before notBefore sleeps only the remainder and records nothing', async () => {
    const ledger = new InMemoryOnceLedger()
    const nowMs = 2_000_000
    const first = rigOf({ script: [{ text: 'unused' }] })
    await seedMessage(first)
    const key = `retry:${THREAD}:s0:1`
    ledger.recordRetry({
      key,
      attempt: 1,
      notBefore: new Date(nowMs + 400).toISOString(),
      reason: ERetryReason.Network,
    })

    const sleeps: number[] = []
    const notices: RetryNotice[] = []
    const second = resumeOn(first, {
      record: first.record,
      onceLedger: ledger,
      retry: fakeRetry({ sleeps, notices, now: () => nowMs }),
      script: [{ text: 'late answer' }],
    })

    const outcome = await second.runner.resume({ threadId: THREAD })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    expect(sleeps).toEqual([400])
    expect(notices).toEqual([
      { attempt: 1, maxAttempts: 5, delayMs: 400, reason: ERetryReason.Network },
    ])
    expect(second.model.requests).toHaveLength(1)
    expect(ledger.retryKeys()).toEqual([key])
  })

  it('does not sleep when the recorded notBefore has passed', async () => {
    const ledger = new InMemoryOnceLedger()
    const nowMs = 3_000_000
    const first = rigOf({ script: [{ text: 'unused' }] })
    await seedMessage(first)
    ledger.recordRetry({
      key: `retry:${THREAD}:s0:1`,
      attempt: 1,
      notBefore: new Date(nowMs - 1_000).toISOString(),
      reason: ERetryReason.Network,
    })

    const sleeps: number[] = []
    const second = resumeOn(first, {
      record: first.record,
      onceLedger: ledger,
      retry: fakeRetry({ sleeps, now: () => nowMs }),
      script: [{ text: 'on time' }],
    })

    const outcome = await second.runner.resume({ threadId: THREAD })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    expect(sleeps).toEqual([])
    expect(second.model.requests).toHaveLength(1)
  })

  it('an expired recalled deadline keeps its attempt count instead of refunding the budget', async () => {
    const ledger = new InMemoryOnceLedger()
    const nowMs = 3_500_000
    const first = rigOf({ script: [{ text: 'unused' }] })
    await seedMessage(first)
    ledger.recordRetry({
      key: `retry:${THREAD}:s0:4`,
      attempt: 4,
      notBefore: new Date(nowMs - 1_000).toISOString(),
      reason: ERetryReason.Network,
    })

    const sleeps: number[] = []
    const second = resumeOn(first, {
      record: first.record,
      onceLedger: ledger,
      retry: fakeRetry({ sleeps, now: () => nowMs }),
      script: [{ throws: new Error('still down') }],
    })

    await expect(second.runner.resume({ threadId: THREAD })).rejects.toThrow('still down')

    expect(second.model.requests).toHaveLength(1)
    expect(sleeps).toEqual([])
  })

  it('aborting with reason handoff during a fresh backoff ends HandoffPaused, never run-failed', async () => {
    const ledger = new InMemoryOnceLedger()
    const controller = new AbortController()
    const nowMs = 5_000_000
    const rig = rigOf({
      script: [{ throws: new Error('boom') }, { text: 'recovered' }],
      overrides: {
        onceLedger: ledger,
        retry: {
          sleep: async () => {
            controller.abort('handoff')
          },
          jitter: () => 0,
          now: () => nowMs,
        },
      },
    })
    await seedMessage(rig)

    const outcome = await rig.runner.resume({ threadId: THREAD, signal: controller.signal })

    expect(outcome.status).toBe(ETurnStatus.HandoffPaused)
    expect(runFailedEvents(rig)).toHaveLength(0)
  })

  it('aborting with reason handoff during a recalled backoff ends HandoffPaused', async () => {
    const ledger = new InMemoryOnceLedger()
    const nowMs = 6_000_000
    const first = rigOf({ script: [{ text: 'unused' }] })
    await seedMessage(first)
    ledger.recordRetry({
      key: `retry:${THREAD}:s0:1`,
      attempt: 1,
      notBefore: new Date(nowMs + 60_000).toISOString(),
      reason: ERetryReason.Network,
    })

    const controller = new AbortController()
    const second = resumeOn(first, {
      record: first.record,
      onceLedger: ledger,
      retry: {
        sleep: async () => {
          controller.abort('handoff')
        },
        jitter: () => 0,
        now: () => nowMs,
      },
      script: [{ text: 'never reached' }],
    })

    const outcome = await second.runner.resume({ threadId: THREAD, signal: controller.signal })

    expect(outcome.status).toBe(ETurnStatus.HandoffPaused)
    expect(second.model.requests).toHaveLength(0)
    expect(runFailedEvents(second)).toHaveLength(0)
  })

  it('a handoff abort surfacing mid-attempt ends HandoffPaused', async () => {
    const controller = new AbortController()
    const model: ModelPort = {
      identity: { id: 'aborting', modelId: 'aborting-1' },
      step: async () => {
        controller.abort('handoff')
        throw new Error('cut by handoff')
      },
    }
    const rig = rigOf({ script: [{ text: 'unused' }], model })
    await seedMessage(rig)

    const outcome = await rig.runner.resume({ threadId: THREAD, signal: controller.signal })

    expect(outcome.status).toBe(ETurnStatus.HandoffPaused)
    expect(runFailedEvents(rig)).toHaveLength(0)
  })

  it('the step base survives intake between attempts and a successor opening intake', async () => {
    const ledger = new InMemoryOnceLedger()
    const t0 = 7_000_000
    let nowMs = t0
    const controllerA = new AbortController()
    let sleepsA = 0
    const a = rigOf({
      script: [{ throws: new Error('boom-1') }, { throws: new Error('boom-2') }],
      overrides: {
        onceLedger: ledger,
        retry: {
          sleep: async () => {
            sleepsA += 1
            if (sleepsA === 1) {
              a.intake.enqueue({ drafts: [saidBody({ text: 'more context' })] })
              return
            }
            controllerA.abort('handoff')
          },
          jitter: () => 0,
          now: () => nowMs,
        },
      },
    })
    await seedMessage(a)

    const outcomeA = await a.runner.resume({ threadId: THREAD, signal: controllerA.signal })

    expect(outcomeA.status).toBe(ETurnStatus.HandoffPaused)
    expect(runFailedEvents(a)).toHaveLength(0)
    expect(ledger.retryKeys()).toEqual([`retry:${THREAD}:s0:1`, `retry:${THREAD}:s0:2`])

    nowMs = t0 + 400
    const sleepsB: number[] = []
    const noticesB: RetryNotice[] = []
    const b = resumeOn(a, {
      record: a.record,
      onceLedger: ledger,
      retry: fakeRetry({ sleeps: sleepsB, notices: noticesB, now: () => nowMs }),
      script: [{ text: 'b answer' }],
    })
    b.intake.enqueue({ drafts: [saidBody({ text: 'late input' })] })

    const outcomeB = await b.runner.resume({ threadId: THREAD })

    expect(outcomeB.status).toBe(ETurnStatus.Completed)
    expect(sleepsB).toEqual([600])
    expect(noticesB).toEqual([
      { attempt: 2, maxAttempts: 5, delayMs: 600, reason: ERetryReason.Network },
    ])
    expect(b.model.requests).toHaveLength(1)
    expect(ledger.retryKeys()).toEqual([`retry:${THREAD}:s0:1`, `retry:${THREAD}:s0:2`])
  })

  it('without a ledger nothing is recorded and the backoff is unchanged', async () => {
    const sleeps: number[] = []
    const nowMs = 4_000_000
    const rig = rigOf({
      script: [{ throws: new Error('boom') }, { text: 'recovered' }],
      overrides: { retry: fakeRetry({ sleeps, now: () => nowMs }) },
    })
    await seedMessage(rig)

    const outcome = await rig.runner.resume({ threadId: THREAD })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    expect(sleeps).toEqual([500])
    expect(
      rig.record.eventsOf(THREAD).filter((event) => String(event.type) === 'fact-recorded'),
    ).toHaveLength(0)
  })
})
