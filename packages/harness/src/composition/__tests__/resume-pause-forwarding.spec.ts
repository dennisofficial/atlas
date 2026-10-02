import {
  EFinishReason,
  ModelPort,
  toRunId,
  toThreadId,
  type ModelStepResult,
  type ProviderIdentity,
} from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { createDeltaChannel } from '../../channel/delta-channel'
import { PauseSignal } from '../../loop/pause-signal'
import { ETurnStatus, type TurnOutcome } from '../../loop/turn-outcome'
import { TurnRunner } from '../../loop/turn-runner.port'
import { LocalRewindMachinery } from '../../store/local-rewind-machinery'
import {
  UnstaffedAgents,
  UnstaffedServices,
  UnstaffedShells,
  openStoreFixture,
} from '../../store/__tests__/harness'
import { TitlingTurnRunner } from '../titling-turn-runner'
import { createTurnPolicyRunner } from '../turn-policy-runner'
import { createUsageTracker } from '../usage-tracker'
import { recordingNotices } from './fakes'

const THREAD = toThreadId('resume-pause')

const paused: TurnOutcome = { status: ETurnStatus.RelocationPaused, runId: toRunId('run-1') }

class PauseRecordingRunner extends TurnRunner {
  readonly resumedWith: (PauseSignal | undefined)[] = []

  say(): Promise<TurnOutcome> {
    return Promise.resolve(paused)
  }

  runTurn(): Promise<TurnOutcome> {
    return Promise.resolve(paused)
  }

  resume(args: { pause?: PauseSignal }): Promise<TurnOutcome> {
    this.resumedWith.push(args.pause)
    return Promise.resolve(paused)
  }
}

class IdleModel extends ModelPort {
  readonly identity: ProviderIdentity = { id: 'anthropic', modelId: 'm' }

  override traits() {
    return { contextWindow: 200_000 }
  }

  step(): Promise<ModelStepResult> {
    return Promise.resolve({ parts: [], toolCalls: [], finishReason: EFinishReason.Stop })
  }
}

describe('resuming a turn through the policy decorator', () => {
  it('passes the caller\'s exact pause signal to the inner runner, and none when the caller gave none', async () => {
    const inner = new PauseRecordingRunner()
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
      model: new IdleModel(),
      summarise: async () => 'summary',
      usage: createUsageTracker({ channel, log: fixture.log }),
      atPercent: () => 90,
      notice: recordingNotices().port,
      readClock: () => 1000,
    })
    const pause = new PauseSignal()
    pause.pause()

    const outcome = await policy.resume({ threadId: THREAD, pause })
    await policy.resume({ threadId: THREAD })

    expect(outcome.status).toBe(ETurnStatus.RelocationPaused)
    expect(inner.resumedWith[0]).toBe(pause)
    expect(inner.resumedWith[1]).toBeUndefined()
    await fixture.close()
  })
})

describe('resuming a turn through the titling decorator', () => {
  it('passes the caller\'s exact pause signal to the inner runner', async () => {
    const inner = new PauseRecordingRunner()
    const fixture = openStoreFixture()
    const titling = new TitlingTurnRunner({
      inner,
      log: fixture.log,
      threads: fixture.threads,
      titler: async () => null,
      notice: recordingNotices().port,
    })
    const pause = new PauseSignal()
    pause.pause()

    const outcome = await titling.resume({ threadId: THREAD, pause })

    expect(outcome.status).toBe(ETurnStatus.RelocationPaused)
    expect(inner.resumedWith[0]).toBe(pause)
    await fixture.close()
  })
})
