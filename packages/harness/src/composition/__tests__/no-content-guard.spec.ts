import {
  EFinishReason,
  noContentDraft,
  toRunId,
  toThreadId,
  type EventDraft,
  type ModelPort,
} from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { createDeltaChannel } from '../../channel/delta-channel'
import { ETurnStatus, type TurnOutcome } from '../../loop/turn-outcome'
import type { TurnRunner } from '../../loop/turn-runner.port'
import { LocalRewindMachinery } from '../../store/local-rewind-machinery'
import {
  CountingIds,
  UnstaffedAgents,
  UnstaffedServices,
  UnstaffedShells,
  openStoreFixture,
} from '../../store/__tests__/harness'
import { createTurnPolicyRunner } from '../turn-policy-runner'
import { createUsageTracker } from '../usage-tracker'
import { recordingNotices } from './fakes'

const THREAD = toThreadId('no-content-main')

const completed: TurnOutcome = { status: ETurnStatus.Completed, runId: toRunId('run-1') }

class CountingRunner implements TurnRunner {
  turns = 0

  private step(): Promise<TurnOutcome> {
    this.turns += 1
    return Promise.resolve(completed)
  }

  say(): Promise<TurnOutcome> {
    return this.step()
  }

  runTurn(): Promise<TurnOutcome> {
    return this.step()
  }

  resume(): Promise<TurnOutcome> {
    return this.step()
  }
}

function open(inner: TurnRunner) {
  const notices = recordingNotices()
  const fixture = openStoreFixture()
  const channel = createDeltaChannel()
  const policy = createTurnPolicyRunner({
    inner,
    log: fixture.log,
    threads: fixture.threads,
    agents: new UnstaffedAgents(),
    machinery: new LocalRewindMachinery({
      agents: new UnstaffedAgents(),
      shells: new UnstaffedShells(),
      services: new UnstaffedServices(),
    }),
    model: {
      identity: { id: 'anthropic', modelId: 'm' },
      traits: () => ({ contextWindow: 200_000 }),
      step: async () => ({ parts: [], toolCalls: [], finishReason: EFinishReason.Stop }),
    } as ModelPort,
    summarise: async () => 'summary',
    usage: createUsageTracker({ channel, log: fixture.log }),
    atPercent: () => 90,
    notice: notices.port,
    ids: new CountingIds('no-content-guard'),
    readClock: () => 1000,
  })
  return { policy, notices, fixture }
}

const placeholderEnding = (turn: number): EventDraft[] => [
  { type: 'user-said', text: `turn ${turn}` },
  noContentDraft(),
]

async function seedStreak(fixture: ReturnType<typeof openStoreFixture>, turns: number) {
  for (let turn = 0; turn < turns; turn += 1) {
    await fixture.log.append({
      threadId: THREAD,
      runId: toRunId(`streak-${turn}`),
      drafts: placeholderEnding(turn),
    })
  }
}

describe('a main session whose turns keep ending with <no content>', () => {
  it('refuses the fourth turn-open loudly instead of funding another silent run', async () => {
    const inner = new CountingRunner()
    const { policy, notices, fixture } = open(inner)
    await seedStreak(fixture, 3)

    const outcome = await policy.say({ threadId: THREAD, text: 'hello again' })

    expect(outcome.status).toBe(ETurnStatus.Failed)
    expect(outcome.status === ETurnStatus.Failed ? outcome.message : '').toMatch(/<no content>/)
    expect(outcome.status === ETurnStatus.Failed ? outcome.message : '').toMatch(/send again/i)
    expect(inner.turns).toBe(0)
    expect(notices.posts.some((post) => post.key === 'no-content-blocked')).toBe(true)
    await fixture.close()
  })

  it('lets exactly one acknowledged turn through, then refuses again if it too ends empty', async () => {
    const inner = new CountingRunner()
    const { policy, fixture } = open(inner)
    await seedStreak(fixture, 3)

    const refused = await policy.say({ threadId: THREAD, text: 'hello again' })
    expect(refused.status).toBe(ETurnStatus.Failed)

    const acknowledged = await policy.say({ threadId: THREAD, text: 'forcing one more turn' })
    expect(acknowledged.status).toBe(ETurnStatus.Completed)
    expect(inner.turns).toBe(1)

    await fixture.log.append({
      threadId: THREAD,
      runId: toRunId('streak-4'),
      drafts: placeholderEnding(4),
    })

    const refusedAgain = await policy.runTurn({ threadId: THREAD })
    expect(refusedAgain.status).toBe(ETurnStatus.Failed)
    expect(inner.turns).toBe(1)
    await fixture.close()
  })

  it('never blocks a thread below the streak limit', async () => {
    const inner = new CountingRunner()
    const { policy, notices, fixture } = open(inner)
    await seedStreak(fixture, 2)

    const outcome = await policy.say({ threadId: THREAD, text: 'fine so far' })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    expect(inner.turns).toBe(1)
    expect(notices.posts.filter((post) => post.key === 'no-content-blocked')).toEqual([])
    await fixture.close()
  })

  it('re-arms from the ledger after a real reply broke the streak', async () => {
    const inner = new CountingRunner()
    const { policy, fixture } = open(inner)
    await seedStreak(fixture, 3)
    await fixture.log.append({
      threadId: THREAD,
      runId: toRunId('real-reply'),
      drafts: [{ type: 'assistant-said', parts: [{ type: 'text', text: 'an actual answer' }] }],
    })

    const healed = await policy.runTurn({ threadId: THREAD })
    expect(healed.status).toBe(ETurnStatus.Completed)
    expect(inner.turns).toBe(1)

    await seedStreak(fixture, 3)
    const refused = await policy.runTurn({ threadId: THREAD })
    expect(refused.status).toBe(ETurnStatus.Failed)
    expect(inner.turns).toBe(1)
    await fixture.close()
  })
})
