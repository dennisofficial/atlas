import { describe, expect, it } from 'bun:test'
import { EFinishReason, toRunId, toThreadId, type EventLogPort } from '@dltech/atlas-core'

import { ActivityTurnRunner } from '../../activity/activity-turn-runner'
import { RuntimeSessionActivity } from '../../activity/runtime-session-activity'
import { createDeltaChannel } from '../../channel/delta-channel'
import { ETurnStatus } from '../../loop/turn-outcome'
import type { TurnPolicy } from '../../loop/turn-policy'
import { withActivityFailures } from '../activity-binding'
import { createTurnPolicyRunner } from '../turn-policy-runner'
import { createUsageTracker } from '../usage-tracker'
import { LocalRewindMachinery } from '../../store/local-rewind-machinery'
import {
  CountingIds,
  UnstaffedAgents,
  UnstaffedShells,
  UnstaffedServices,
  openStoreFixture,
} from '../../store/__tests__/harness'

const threadId = toThreadId('root')

describe('activity through the existing turn policy crash seam', () => {
  it.each([false, true])(
    'keeps working during real policy finalization, with failure=%s',
    async (fail) => {
      const fixture = openStoreFixture()
      await fixture.threads.create({ id: threadId })
      const channel = createDeltaChannel()
      const activity = new RuntimeSessionActivity({
        log: fixture.log,
        input: { pending: () => null },
        channel,
        roster: { read: async () => ({ agents: [], shells: [] }), subscribe: () => () => {} },
      })
      const outcome = {
        status: ETurnStatus.Completed,
        runId: toRunId('completed-before-policy'),
      } as const
      const runner = new ActivityTurnRunner({
        inner: {
          say: async () => outcome,
          runTurn: async () => outcome,
          resume: async () => outcome,
        },
        lifecycle: activity,
      })
      const gate = Promise.withResolvers<void>()
      const entered = Promise.withResolvers<void>()
      const log: EventLogPort = {
        append: (request) => fixture.log.append(request),
        refresh: (request) => fixture.log.refresh(request),
        head: (request) => fixture.log.head(request),
        readOwn: (request) => fixture.log.readOwn(request),
        replace: (request) => fixture.log.replace(request),
        read: async (request) => {
          entered.resolve()
          await gate.promise
          return fixture.log.read(request)
        },
      }
      const agents = new UnstaffedAgents()
      const realPolicy = createTurnPolicyRunner({
        inner: runner,
        log,
        threads: fixture.threads,
        agents,
        machinery: new LocalRewindMachinery({
          agents,
          shells: new UnstaffedShells(),
          services: new UnstaffedServices(),
        }),
        model: {
          identity: { id: 'test', modelId: 'test' },
          traits: () => ({ contextWindow: 200_000 }),
          step: async () => ({ parts: [], toolCalls: [], finishReason: EFinishReason.Stop }),
        },
        summarise: async () => 'summary',
        usage: createUsageTracker({ channel, log }),
        atPercent: () => 90,
        notice: { notify: () => {} },
        ids: new CountingIds('activity-policy'),
        readClock: () => 0,
      })
      const policy = withActivityFailures({ policy: realPolicy, activity })
      let pending: Promise<void> | undefined
      try {
        const result = await runner.runTurn({ threadId })
        pending = policy.onOutcome({ threadId, outcome: result })
        await Promise.race([
          entered.promise,
          pending.then(() => {
            throw new Error('policy settled before the read gate')
          }),
        ])
        expect(await activity.read({ threadId })).toMatchObject({
          turnEpoch: 1,
          working: true,
          observedOutcome: {
            identity: { kind: 'run', runId: 'completed-before-policy' },
            outcome: 'completed',
          },
        })
        if (fail) {
          const failure = new Error('real policy read failed')
          gate.reject(failure)
          await expect(pending).rejects.toBe(failure)
          await policy.onCrashed({ threadId })
          expect(await activity.read({ threadId })).toMatchObject({
            turnEpoch: 1,
            working: false,
            observedOutcome: { identity: { kind: 'driver-failure' }, outcome: 'failed' },
          })
        } else {
          gate.resolve()
          await pending
          expect(await activity.read({ threadId })).toMatchObject({
            turnEpoch: 1,
            working: false,
            observedOutcome: {
              identity: { kind: 'run', runId: 'completed-before-policy' },
              outcome: 'completed',
            },
          })
        }
      } finally {
        gate.resolve()
        await pending?.catch(() => {})
        activity.close()
        await fixture.close()
      }
    },
  )

  it('records a post-run onOutcome failure and delegates onCrashed without replacing its result', async () => {
    const activity = new RuntimeSessionActivity({
      runtimeId: 'runtime',
      log: { refresh: async () => {}, readOwn: async () => [] },
      input: { pending: () => null },
      channel: createDeltaChannel(),
      roster: { read: async () => ({ agents: [], shells: [] }), subscribe: () => () => {} },
    })
    const outcome = { status: ETurnStatus.Completed, runId: toRunId('actual') } as const
    const runner = new ActivityTurnRunner({
      inner: {
        say: async () => outcome,
        runTurn: async () => outcome,
        resume: async () => outcome,
      },
      lifecycle: activity,
    })
    const failure = new Error('onOutcome failed after the runner returned')
    const delegated: string[] = []
    const policy: TurnPolicy = {
      onOutcome: async () => {
        throw failure
      },
      onCrashed: async ({ threadId }) => {
        delegated.push(threadId)
      },
      state: () => ({ type: 'idle' }),
      subscribe: () => () => {},
      cancelCompaction: () => false,
      suppress: () => {},
      undone: () => null,
    }
    const decorated = withActivityFailures({ policy, activity })
    const result = await runner.runTurn({ threadId })
    await expect(decorated.onOutcome({ threadId, outcome: result })).rejects.toBe(failure)
    await expect(decorated.onCrashed({ threadId })).resolves.toBeUndefined()
    expect(delegated).toEqual(['root'])
    const reading = await activity.read({ threadId })
    expect(reading).toMatchObject({
      turnEpoch: 1,
      working: false,
      observedOutcome: {
        identity: { kind: 'driver-failure', runtimeId: 'runtime', revision: 6 },
        outcome: 'failed',
      },
    })
    await decorated.onCrashed({ threadId })
    expect(await activity.read({ threadId })).toEqual(reading)
    const delegateFailure = new Error('original onCrashed failed')
    const failing = withActivityFailures({
      policy: {
        ...policy,
        onCrashed: async () => {
          throw delegateFailure
        },
      },
      activity,
    })
    await expect(failing.onCrashed({ threadId })).rejects.toBe(delegateFailure)
    expect(await activity.read({ threadId })).toEqual(reading)
    activity.close()
  })
})
