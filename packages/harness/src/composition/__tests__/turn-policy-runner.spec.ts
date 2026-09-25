import {
  EFinishReason,
  toRunId,
  toThreadId,
  type Event,
  type ModelPort,
  type ThreadId,
} from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { ETurnStatus, type TurnOutcome } from '../../loop/turn-outcome'
import { createDeltaChannel } from '../../channel/delta-channel'
import { ESuppress, type TurnPolicyState } from '../../loop/turn-policy'
import type { TurnRunner } from '../../loop/turn-runner.port'
import { LocalRewindMachinery } from '../../store/local-rewind-machinery'
import { createTurnPolicyRunner } from '../turn-policy-runner'
import { createUsageTracker } from '../usage-tracker'
import { recordingNotices } from './fakes'
import {
  UnstaffedAgents,
  UnstaffedServices,
  UnstaffedShells,
  openStoreFixture,
} from '../../store/__tests__/harness'

const THREAD = toThreadId('policy')

const completed: TurnOutcome = { status: ETurnStatus.Completed, runId: toRunId('run-1') }
const interruptedEmpty: TurnOutcome = {
  status: ETurnStatus.Interrupted,
  runId: toRunId('run-1'),
  committed: false,
}
const interruptedCommitted: TurnOutcome = {
  status: ETurnStatus.Interrupted,
  runId: toRunId('run-1'),
  committed: true,
}

const noopRunner = (): TurnRunner => ({
  say: async () => completed,
  runTurn: async () => completed,
  resume: async () => completed,
})

const policyWith = (args: {
  used?: number
  atPercent?: number
  onSettled?: (state: TurnPolicyState) => void
  runner?: TurnRunner
}) => {
  const notices = recordingNotices()
  const fixture = openStoreFixture()
  const channel = createDeltaChannel()
  const usage = createUsageTracker({ channel, log: fixture.log })
  channel.subscribe({
    threadId: THREAD,
    listener: (signal) => {
      if (signal.type === 'chunk') usage.onChunk({ threadId: THREAD, chunk: signal.chunk })
    },
  })

  const machinery = new LocalRewindMachinery({
    agents: new UnstaffedAgents(),
    shells: new UnstaffedShells(),
    services: new UnstaffedServices(),
  })

  const policy = createTurnPolicyRunner({
    inner: args.runner ?? noopRunner(),
    log: fixture.log,
    threads: fixture.threads,
    agents: new UnstaffedAgents(),
    machinery,
    model: {
      identity: { id: 'anthropic', modelId: 'm' },
      traits: () => ({ contextWindow: 200_000 }),
      step: async () => ({ parts: [], toolCalls: [], finishReason: EFinishReason.Stop }),
    } as ModelPort,
    summarise: async () => 'summary',
    usage,
    atPercent: () => args.atPercent ?? 90,
    notice: notices.port,
    readClock: () => 1000,
  })

  if (args.onSettled !== undefined) policy.subscribe(args.onSettled)

  return { policy, notices, fixture, channel }
}

const sayEvents = async (fixture: ReturnType<typeof openStoreFixture>): Promise<void> => {
  await fixture.log.append({
    threadId: THREAD,
    runId: toRunId('run-1'),
    drafts: [
      { type: 'user-said', text: 'a message long enough to estimate a real token count from the log, so compaction can decide on a settled turn that left no fresh usage report'.repeat(4) },
    ],
  })
}

const sayTwoTurns = async (fixture: ReturnType<typeof openStoreFixture>): Promise<void> => {
  await fixture.log.append({
    threadId: THREAD,
    runId: toRunId('run-1'),
    drafts: [{ type: 'user-said', text: 'the earlier ask, the one a compaction can afford to hide' }],
  })
  await sayEvents(fixture)
}

const reportFullWindow = (channel: ReturnType<typeof createDeltaChannel>): void => {
  channel
    .publisherFor({ threadId: THREAD })
    .onChunk({
      type: 'finish',
      reason: EFinishReason.Stop,
      usage: { inputTokens: 150_000, outputTokens: 5_000 },
    })
}

describe('the turn policy the shared root composes', () => {
  it('compacts after a turn that filled the window past the threshold', async () => {
    const seen: TurnPolicyState[] = []
    const { policy, notices, fixture, channel } = policyWith({
      atPercent: 1,
      onSettled: (state) => seen.push(state),
    })
    await sayTwoTurns(fixture)
    reportFullWindow(channel)

    await policy.onOutcome({ threadId: THREAD, outcome: completed })

    expect(seen.some((state) => state.type === 'compacting')).toBe(true)
    expect(seen.at(-1)).toEqual({ type: 'idle' })
    expect(notices.posts.some((post) => post.key === 'auto-compaction')).toBe(true)
    await fixture.close()
  })

  it('holds when the window is under the threshold', async () => {
    const seen: TurnPolicyState[] = []
    const { policy, notices, fixture } = policyWith({
      atPercent: 90,
      onSettled: (state) => seen.push(state),
    })

    await policy.onOutcome({ threadId: THREAD, outcome: completed })

    expect(seen).toEqual([])
    expect(notices.posts.filter((post) => post.key === 'auto-compaction')).toEqual([])
    await fixture.close()
  })

  it('hands an interrupted turn that committed nothing back to the composer', async () => {
    const { policy, notices, fixture } = policyWith({ atPercent: 0 })
    await sayEvents(fixture)

    await policy.onOutcome({ threadId: THREAD, outcome: interruptedEmpty })

    const said = policy.undone()
    expect(said).not.toBeNull()
    expect(said?.text).toContain('a message long enough')
    expect(notices.posts.some((post) => post.key === 'turn-undo' && post.text.includes('taken back'))).toBe(true)
    expect((await fixture.log.read({ threadId: THREAD })).length).toBe(0)
    await fixture.close()
  })

  it('keeps an interrupted turn that already committed', async () => {
    const { policy, notices, fixture } = policyWith({ atPercent: 0 })
    await sayEvents(fixture)

    await policy.onOutcome({ threadId: THREAD, outcome: interruptedCommitted })

    expect(policy.undone()).toBeNull()
    expect(notices.posts.filter((post) => post.key === 'turn-undo')).toEqual([])
    expect((await fixture.log.read({ threadId: THREAD })).length).toBe(1)
    await fixture.close()
  })

  it('honours the suppress the surface wires in for a directory move', async () => {
    const { policy, fixture } = policyWith({ atPercent: 0 })
    await sayEvents(fixture)

    policy.suppress(ESuppress.UndoOnce)
    await policy.onOutcome({ threadId: THREAD, outcome: interruptedEmpty })

    expect(policy.undone()).toBeNull()
    expect((await fixture.log.read({ threadId: THREAD })).length).toBe(1)

    policy.suppress(ESuppress.None)
    await fixture.close()
  })

  it('clears a crash without pretending the turn settled', async () => {
    const { policy, fixture } = policyWith({ atPercent: 0 })
    await sayEvents(fixture)

    await policy.onCrashed({ threadId: THREAD })

    expect(policy.undone()).toBeNull()
    expect(policy.state()).toEqual({ type: 'idle' })
    await fixture.close()
  })

  it('cancelCompaction takes an in-flight compaction down', async () => {
    const seen: TurnPolicyState[] = []
    const { policy, fixture, channel } = policyWith({
      atPercent: 1,
      onSettled: (state) => seen.push(state),
    })
    await sayTwoTurns(fixture)
    reportFullWindow(channel)

    expect(policy.cancelCompaction()).toBe(false)

    await policy.onOutcome({ threadId: THREAD, outcome: completed })

    expect(seen.some((state) => state.type === 'compacting')).toBe(true)
    await fixture.close()
  })
})

describe('the usage tracker the policy reads from', () => {
  it('answers the reported usage for a completed turn', async () => {
    const channel = createDeltaChannel()
    const fixture = openStoreFixture()
    const usage = createUsageTracker({ channel, log: fixture.log })
    channel.subscribe({
      threadId: THREAD,
      listener: (signal) => {
        if (signal.type === 'chunk') usage.onChunk({ threadId: THREAD, chunk: signal.chunk })
      },
    })

    await fixture.log.append({
      threadId: THREAD,
      runId: toRunId('run-1'),
      drafts: [{ type: 'user-said', text: 'hello' }],
    })
    await fixture.log.append({
      threadId: THREAD,
      runId: toRunId('run-1'),
      drafts: [{ type: 'assistant-said', parts: [{ type: 'text', text: 'answered' }] }],
    })

    const publisher = channel.publisherFor({ threadId: THREAD })
    publisher.onChunk({ type: 'finish', reason: EFinishReason.Stop, usage: { inputTokens: 150_000, outputTokens: 5_000 } })

    const used = await usage.usageOf({ threadId: THREAD, outcome: completed })
    expect(used).toBe(155_000)

    await fixture.close()
  })

  it('falls back to the log estimate for an interrupted turn that left no reading', async () => {
    const channel = createDeltaChannel()
    const fixture = openStoreFixture()
    const usage = createUsageTracker({ channel, log: fixture.log })

    await fixture.log.append({
      threadId: THREAD,
      runId: toRunId('run-1'),
      drafts: [{ type: 'user-said', text: 'short' }],
    })

    const used = await usage.usageOf({ threadId: THREAD, outcome: interruptedEmpty })
    expect(used).toBeGreaterThan(0)

    await fixture.close()
  })
})
