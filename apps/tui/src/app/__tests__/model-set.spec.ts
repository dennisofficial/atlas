import { describe, expect, test } from 'bun:test'

import { EEffort, parseRef } from '@dltech/atlas-core'

import type { SwitcherChoice } from '../../ui/switcher-model'
import { applyModelSet, choiceOfModel, effortOf, modelSetArgsOf } from '../model-set'
import type { SessionCommandInput } from '@dltech/atlas-protocol'

const choiceOf = (over: Partial<SwitcherChoice>): SwitcherChoice => ({
  ref: parseRef('anthropic/x') ?? null,
  effort: EEffort.High,
  fast: false,
  ...over,
})

describe('modelSetArgsOf', () => {
  test('names the model by its ref key and the rung by its name', () => {
    expect(modelSetArgsOf({ choice: choiceOf({}) })).toEqual({
      model: 'anthropic/x',
      effort: 'high',
    })
  })

  test('fast is sent only when it is set', () => {
    expect(modelSetArgsOf({ choice: choiceOf({ fast: true }) })).toEqual({
      model: 'anthropic/x',
      effort: 'high',
      fast: true,
    })
  })

  test('nothing picked is null', () => {
    expect(modelSetArgsOf({ choice: choiceOf({ ref: null }) })).toBeNull()
  })
})

describe('choiceOfModel', () => {
  test('the row model becomes a choice with a rung name', () => {
    expect(choiceOfModel({ model: { ref: 'anthropic/x', effort: 'low', fast: true } })).toEqual({
      ref: { providerId: 'anthropic', modelId: 'x' },
      effort: EEffort.Low,
      fast: true,
    })
  })

  test('an unknown effort falls back to medium', () => {
    expect(effortOf('ludicrous')).toBe(EEffort.Medium)
  })
})

describe('applyModelSet', () => {
  test('records one model-set command on the session', async () => {
    const calls: SessionCommandInput[] = []
    await applyModelSet({
      api: {
        runCommand: async (input) => {
          calls.push(input)
          return {}
        },
      },
      sessionId: 'session-1',
      choice: choiceOf({}),
    })

    expect(calls).toEqual([
      { sessionId: 'session-1', name: 'model-set', args: { model: 'anthropic/x', effort: 'high' } },
    ])
  })

  test('a null ref posts nothing', async () => {
    const calls: SessionCommandInput[] = []
    await applyModelSet({
      api: {
        runCommand: async (input) => {
          calls.push(input)
          return {}
        },
      },
      sessionId: 'session-1',
      choice: choiceOf({ ref: null }),
    })
    expect(calls).toHaveLength(0)
  })
})
