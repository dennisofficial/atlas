import { describe, expect, it } from 'bun:test'

import {
  EBootStep,
  EBootStepOutcome,
  EBootStepState,
  NOOP_BOOT_REPORTER,
  type BootReporter,
  type BootStepEvent,
} from '@dltech/atlas-wire'

import { EWorkspaceState, EWorkspaceStep } from '../materialize-workspace'
import { trackAgentStep, trackClone } from '../serve-boot-reporter'

const recorder = () => {
  const events: BootStepEvent[] = []
  const order: string[] = []
  const reporter: BootReporter = {
    ...NOOP_BOOT_REPORTER,
    report: async (event) => {
      events.push(event)
      order.push(`report:${event.state}`)
    },
    flush: async () => {
      order.push('flush')
    },
  }
  return { events, order, reporter }
}

describe('trackClone', () => {
  it('reports Running with repos on each progress call and Done with the final repos', async () => {
    const { events, reporter } = recorder()
    const final = [{ repo: 'o/a', state: EBootStepState.Done }]

    await trackClone({
      reporter,
      work: async (progress) => {
        progress([{ repo: 'o/a', state: EBootStepState.Running }])
        return { state: EWorkspaceState.Materialized, repos: final }
      },
    })

    expect(events).toEqual([
      { step: EBootStep.Clone, state: EBootStepState.Running },
      {
        step: EBootStep.Clone,
        state: EBootStepState.Running,
        repos: [{ repo: 'o/a', state: EBootStepState.Running }],
      },
      {
        step: EBootStep.Clone,
        state: EBootStepState.Done,
        outcome: EBootStepOutcome.Cloned,
        repos: final,
      },
    ])
  })

  it('reports Error with the reason when the workspace failed', async () => {
    const { events, reporter } = recorder()

    await trackClone({
      reporter,
      work: async () => ({
        state: EWorkspaceState.Failed,
        step: EWorkspaceStep.Clone,
        reason: 'boom',
      }),
    })

    expect(events.at(-1)).toEqual({
      step: EBootStep.Clone,
      state: EBootStepState.Error,
      error: 'boom',
    })
  })

  it('flushes the Error event before rethrowing when the work rejects', async () => {
    const { order, reporter } = recorder()

    await expect(
      trackClone({
        reporter,
        work: async () => {
          throw new Error('git exploded')
        },
      }),
    ).rejects.toThrow('git exploded')

    expect(order.slice(-2)).toEqual(['report:error', 'flush'])
  })

  it('reports the repos on a failed workspace', async () => {
    const { events, reporter } = recorder()
    const repos = [{ repo: 'o/a', state: EBootStepState.Error, error: 'nope' }]

    await trackClone({
      reporter,
      work: async () => ({
        state: EWorkspaceState.Failed,
        step: EWorkspaceStep.Clone,
        reason: 'nope',
        repos,
      }),
    })

    expect(events.at(-1)).toEqual({
      step: EBootStep.Clone,
      state: EBootStepState.Error,
      error: 'nope',
      repos,
    })
  })
})

describe('trackAgentStep', () => {
  it('flushes the reporter before the strict sink runs', async () => {
    const { order, reporter } = recorder()

    await trackAgentStep({
      reporter,
      strictSink: async () => {
        order.push('strict')
      },
      work: async () => 1,
    })

    expect(order.slice(0, 2)).toEqual(['flush', 'strict'])
  })

  it('flushes the Error event before rethrowing when the work rejects', async () => {
    const { order, reporter } = recorder()

    await expect(
      trackAgentStep({
        reporter,
        strictSink: async () => undefined,
        work: async () => {
          throw new Error('compose failed')
        },
      }),
    ).rejects.toThrow('compose failed')

    expect(order.slice(-2)).toEqual(['report:error', 'flush'])
  })

  it('flushes the Error event before rethrowing when the strict sink rejects', async () => {
    const { order, reporter } = recorder()

    await expect(
      trackAgentStep({
        reporter,
        strictSink: async () => {
          throw new Error('500')
        },
        work: async () => 1,
      }),
    ).rejects.toThrow('500')

    expect(order.slice(-2)).toEqual(['report:error', 'flush'])
  })
})
