import { describe, expect, it } from 'bun:test'

import { runInCallScope } from '../../calls/call-scope'
import {
  EFFECT_RESULT_KIND,
  effectResultKeyOf,
  runHostStep,
  type EffectResultLookup,
  type HostStepFacts,
} from '../host-step'
import type { StepRecord } from '../record/call-steps'

const SCOPE = '11111111-1111-4111-8111-111111111111'
const SPAWN = 'host.sessions.spawn'

const rigOf = () => {
  const steps: StepRecord[] = []
  const results = new Map<string, unknown>()
  const facts: HostStepFacts = {
    recorded: () => steps.map((step) => ({ ...step })),
    record: async (step) => {
      steps.push(step)
    },
    result: <T>(stepKey: string): EffectResultLookup<T> => {
      const key = effectResultKeyOf(stepKey)
      return results.has(key) ? { found: true, value: results.get(key) as T } : { found: false }
    },
    recordResult: async (stepKey, value) => {
      results.set(effectResultKeyOf(stepKey), value)
    },
  }
  return { facts, steps, results }
}

const inScope = <T>(body: () => Promise<T>): Promise<T> => runInCallScope({ scopeKey: SCOPE, body })

const spawnOf = (args: { facts: HostStepFacts; ran: string[]; value: unknown }) =>
  runHostStep({
    facts: args.facts,
    op: SPAWN,
    input: { title: 'Lexer rewrite' },
    run: async (key) => {
      args.ran.push(key)
      return args.value
    },
  })

describe('runHostStep', () => {
  it('records the step before it runs the effect, then records the result', async () => {
    const rig = rigOf()
    const ran: string[] = []
    const seen: number[] = []
    const value = await inScope(async () =>
      runHostStep({
        facts: rig.facts,
        op: SPAWN,
        input: { title: 'x' },
        run: async (key) => {
          seen.push(rig.steps.filter((step) => step.key === key).length)
          ran.push(key)
          return { sessionId: 'derived-from-key' }
        },
      }),
    )
    expect(seen).toEqual([1])
    expect(ran).toEqual([`${SCOPE}.0`])
    expect(rig.steps).toHaveLength(1)
    expect(rig.steps[0]?.key).toBe(`${SCOPE}.0`)
    expect(rig.steps[0]?.op).toBe(SPAWN)
    expect(rig.results.get(effectResultKeyOf(`${SCOPE}.0`))).toEqual({
      sessionId: 'derived-from-key',
    })
    expect(value).toEqual({ sessionId: 'derived-from-key' })
  })

  it('replays a recorded step from its result fact without running it again', async () => {
    const rig = rigOf()
    const ran: string[] = []
    const first = await inScope(async () =>
      spawnOf({ facts: rig.facts, ran, value: { sessionId: 's1' } }),
    )
    const second = await inScope(async () =>
      spawnOf({ facts: rig.facts, ran, value: { sessionId: 's2' } }),
    )
    expect(second).toEqual(first)
    expect(second).toEqual({ sessionId: 's1' })
    expect(ran).toEqual([`${SCOPE}.0`])
    expect(rig.steps).toHaveLength(1)
  })

  it('runs a replayed step again under its recorded key when no result was recorded', async () => {
    const rig = rigOf()
    const ran: string[] = []
    await inScope(async () => spawnOf({ facts: rig.facts, ran, value: { sessionId: 's1' } }))
    const stepKey = `${SCOPE}.0`
    for (const key of [...rig.results.keys()]) rig.results.delete(key)
    const replayed = await inScope(async () =>
      spawnOf({ facts: rig.facts, ran, value: { sessionId: 's2' } }),
    )
    expect(ran).toEqual([stepKey, stepKey])
    expect(replayed).toEqual({ sessionId: 's2' })
    expect(rig.steps).toHaveLength(1)
  })

  it('appends a new slot when a replay runs a different effect at the same position', async () => {
    const rig = rigOf()
    const ran: string[] = []
    await inScope(async () =>
      runHostStep({
        facts: rig.facts,
        op: SPAWN,
        input: { title: 'first' },
        run: async (key) => {
          ran.push(key)
          return { sessionId: 's1' }
        },
      }),
    )
    await inScope(async () =>
      runHostStep({
        facts: rig.facts,
        op: SPAWN,
        input: { title: 'second' },
        run: async (key) => {
          ran.push(key)
          return { sessionId: 's2' }
        },
      }),
    )
    expect(ran).toEqual([`${SCOPE}.0`, `${SCOPE}.1`])
    expect(rig.steps.map((step) => step.key)).toEqual([`${SCOPE}.0`, `${SCOPE}.1`])
  })

  it('takes two identical effects as two slots in one execution', async () => {
    const rig = rigOf()
    const ran: string[] = []
    await inScope(async () => {
      await spawnOf({ facts: rig.facts, ran, value: { sessionId: 's1' } })
      await spawnOf({ facts: rig.facts, ran, value: { sessionId: 's2' } })
    })
    expect(ran).toEqual([`${SCOPE}.0`, `${SCOPE}.1`])
    expect(rig.results.get(effectResultKeyOf(`${SCOPE}.1`))).toEqual({ sessionId: 's2' })
  })

  it('records nothing and runs the effect under a throwaway key outside a call scope', async () => {
    const rig = rigOf()
    const ran: string[] = []
    await spawnOf({ facts: rig.facts, ran, value: { sessionId: 's1' } })
    expect(rig.steps).toEqual([])
    expect(rig.results.size).toBe(0)
    expect(ran).toHaveLength(1)
    expect(ran[0]?.startsWith('host-no-step-')).toBe(true)
  })

  it('names the result fact under the effect-result kind', () => {
    expect(EFFECT_RESULT_KIND).toBe('effect-result')
    expect(effectResultKeyOf(`${SCOPE}.2`)).toBe(`effect-result:${SCOPE}.2`)
  })
})
