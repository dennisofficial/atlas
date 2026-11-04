import { describe, expect, it } from 'bun:test'

import { ERetryReason, saidBody, toRunId } from '@dltech/atlas-core'

import { rigOf, THREAD, transientFailure } from '../../__tests__/exit-fixture'
import { InMemoryModelContext, InMemoryOnceLedger } from '../../testing'
import type { RetryNotice } from '../retrying-step'
import { ETurnStatus } from '../turn-outcome'

const seedMessage = async (rig: ReturnType<typeof rigOf>): Promise<number> => {
  await rig.record.append({
    threadId: THREAD,
    runId: toRunId('run-seed'),
    drafts: [saidBody({ text: 'hi' })],
  })
  const last = rig.record.eventsOf(THREAD).at(-1)
  if (last === undefined) throw new Error('seed did not land')
  return last.seq
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
    const baseSeq = await seedMessage(rig)

    const outcome = await rig.runner.resume({ threadId: THREAD })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    const key = `retry:${THREAD}:s${baseSeq}:1`
    expect(ledger.has(key)).toBe(true)
    const facts = await ledger.recall({ prefix: `retry:${THREAD}:s${baseSeq}:` })
    expect(facts).toEqual([
      {
        key,
        value: { notBefore: new Date(nowMs + 500).toISOString(), reason: ERetryReason.Network },
      },
    ])
    expect(sleeps).toEqual([500])
    expect(notices).toEqual([
      { attempt: 1, maxAttempts: 5, delayMs: 500, reason: ERetryReason.Network },
    ])
  })

  it('a second runner before notBefore sleeps only the remainder and records nothing', async () => {
    const ledger = new InMemoryOnceLedger()
    const nowMs = 2_000_000
    const first = rigOf({ script: [{ text: 'unused' }] })
    const baseSeq = await seedMessage(first)
    const key = `retry:${THREAD}:s${baseSeq}:1`
    ledger.record(key, {
      notBefore: new Date(nowMs + 400).toISOString(),
      reason: ERetryReason.Network,
    })

    const sleeps: number[] = []
    const notices: RetryNotice[] = []
    const second = rigOf({
      script: [{ text: 'late answer' }],
      overrides: {
        record: first.record,
        modelContext: new InMemoryModelContext(first.record),
        onceLedger: ledger,
        retry: fakeRetry({ sleeps, notices, now: () => nowMs }),
      },
    })

    const outcome = await second.runner.resume({ threadId: THREAD })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    expect(sleeps).toEqual([400])
    expect(notices).toEqual([
      { attempt: 1, maxAttempts: 5, delayMs: 400, reason: ERetryReason.Network },
    ])
    expect(second.model.requests).toHaveLength(1)
    expect(ledger.keys()).toEqual([key])
  })

  it('does not sleep when the recorded notBefore has passed', async () => {
    const ledger = new InMemoryOnceLedger()
    const nowMs = 3_000_000
    const first = rigOf({ script: [{ text: 'unused' }] })
    const baseSeq = await seedMessage(first)
    ledger.record(`retry:${THREAD}:s${baseSeq}:1`, {
      notBefore: new Date(nowMs - 1_000).toISOString(),
      reason: ERetryReason.Network,
    })

    const sleeps: number[] = []
    const second = rigOf({
      script: [{ text: 'on time' }],
      overrides: {
        record: first.record,
        modelContext: new InMemoryModelContext(first.record),
        onceLedger: ledger,
        retry: fakeRetry({ sleeps, now: () => nowMs }),
      },
    })

    const outcome = await second.runner.resume({ threadId: THREAD })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    expect(sleeps).toEqual([])
    expect(second.model.requests).toHaveLength(1)
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
      rig.record.eventsOf(THREAD).filter((event) => event.type === 'fact-recorded'),
    ).toHaveLength(0)
  })
})
