import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'vitest'

import { EQualityImpact, type DecisionOutcome } from '@dltech/atlas-core'
import { singleResponsibilityPolicy } from '@dltech/atlas-plugin-quality/review'

import {
  JEV_REAL_MODEL,
  type JevRealDecide,
  JevRealItemError,
  parseJevRealItems,
  runJevRealItem,
} from '../jev-real'
import { summarizeJevReal } from '../jev-real-metrics'

const FIXTURE = new URL('../../__fixtures__/jev-real/items.jsonl', import.meta.url)

const fixtureItems = (): readonly ReturnType<typeof parseJevRealItems>[number][] =>
  parseJevRealItems({ text: readFileSync(FIXTURE, 'utf8') })

const nudgeAnswers = (): DecisionOutcome => ({
  ok: true,
  model: JEV_REAL_MODEL,
  answers: {
    'single-responsibility:currentConcern': { noul: 0.93 },
    'single-responsibility:impact': {
      choice: EQualityImpact.Introduced,
      probabilities: { [EQualityImpact.Introduced]: 0.92 },
    },
    'single-responsibility:focus': {
      choice: 'synthetic-evidence-1',
      probabilities: { 'synthetic-evidence-1': 0.9 },
    },
  },
})

const cohesiveAnswers = (): DecisionOutcome => ({
  ok: true,
  model: JEV_REAL_MODEL,
  answers: {
    'single-responsibility:currentConcern': { noul: 0.12 },
    'single-responsibility:impact': {
      choice: EQualityImpact.Unchanged,
      probabilities: { [EQualityImpact.Unchanged]: 0.88 },
    },
    'single-responsibility:focus': {
      choice: 'none',
      probabilities: { none: 0.9 },
    },
  },
})

const debtAnswers = (): DecisionOutcome => ({
  ok: true,
  model: JEV_REAL_MODEL,
  answers: {
    'single-responsibility:currentConcern': { noul: 0.9 },
    'single-responsibility:impact': {
      choice: EQualityImpact.Unchanged,
      probabilities: { [EQualityImpact.Unchanged]: 0.9 },
    },
    'single-responsibility:focus': {
      choice: 'none',
      probabilities: { none: 0.9 },
    },
  },
})

const decideWith =
  (outcome: () => DecisionOutcome): JevRealDecide =>
  async () =>
    outcome()

describe('parseJevRealItems', () => {
  test('reads the synthetic fixture', () => {
    const items = fixtureItems()
    expect(items).toHaveLength(2)
    expect(items[0]?.metadata.stratum).toBe('nudge')
    expect(items[1]?.expected_output.notify).toBe(false)
  })

  test('rejects a line that is not a dataset item', () => {
    expect(() => parseJevRealItems({ text: '{"input":{}}' })).toThrow(JevRealItemError)
  })

  test('rejects an empty file', () => {
    expect(() => parseJevRealItems({ text: '\n\n' })).toThrow(JevRealItemError)
  })
})

describe('runJevRealItem', () => {
  test('reproduces a nudge with the production interpretation', async () => {
    const [item] = fixtureItems()
    if (item === undefined) throw new Error('fixture is empty')
    const row = await runJevRealItem({
      item,
      policies: [singleResponsibilityPolicy],
      decide: decideWith(nudgeAnswers),
    })
    expect(row.error).toBeNull()
    expect(row.actual?.notify).toBe(true)
    expect(row.actual?.transition).toBe('introduce')
    expect(row.actual?.status).toBe('completed')
    expect(row.notifyMatch).toBe(true)
    expect(row.impactMatch).toBe(true)
  })

  test('reproduces a withheld nudge for a cohesive scope', async () => {
    const item = fixtureItems()[1]
    if (item === undefined) throw new Error('fixture is empty')
    const row = await runJevRealItem({
      item,
      policies: [singleResponsibilityPolicy],
      decide: decideWith(cohesiveAnswers),
    })
    expect(row.error).toBeNull()
    expect(row.actual?.notify).toBe(false)
    expect(row.notifyMatch).toBe(true)
    const summary = summarizeJevReal({ rows: [row] })
    expect(summary.precision).toBeNull()
    expect(summary.expectedNudges).toBe(0)
  })

  test('replays a debt item as a nudge through the production ledger', async () => {
    const item = fixtureItems()[1]
    if (item === undefined) throw new Error('fixture is empty')
    const debtItem = {
      ...item,
      expected_output: { notify: true, impact: EQualityImpact.Unchanged },
    }
    const row = await runJevRealItem({
      item: debtItem,
      policies: [singleResponsibilityPolicy],
      decide: decideWith(debtAnswers),
    })
    expect(row.error).toBeNull()
    expect(row.actual?.transition).toBe('track_debt')
    expect(row.actual?.notify).toBe(true)
    expect(row.notifyMatch).toBe(true)
    expect(row.impactMatch).toBe(true)
  })

  test('records a failed decision call as an errored row, not a grade of zero', async () => {
    const [item] = fixtureItems()
    if (item === undefined) throw new Error('fixture is empty')
    const row = await runJevRealItem({
      item,
      policies: [singleResponsibilityPolicy],
      decide: decideWith(() => ({ ok: false, fault: 'timeout' })),
    })
    expect(row.actual).toBeNull()
    expect(row.error).toContain('decision call failed: timeout')
    expect(summarizeJevReal({ rows: [row] }).status).toBe('incomplete')
  })

  test('refuses a decision that resolved a different model', async () => {
    const [item] = fixtureItems()
    if (item === undefined) throw new Error('fixture is empty')
    const row = await runJevRealItem({
      item,
      policies: [singleResponsibilityPolicy],
      decide: async () => ({ ok: true, model: 'some-other-model', answers: {} }),
    })
    expect(row.error).toContain('model identity mismatch')
  })

  test('accepts the recorded state written as an object', async () => {
    const [item] = fixtureItems()
    if (item === undefined) throw new Error('fixture is empty')
    const objectState = { ...item, input: { state: JSON.parse(item.input.state as string) } }
    const row = await runJevRealItem({
      item: objectState,
      policies: [singleResponsibilityPolicy],
      decide: decideWith(nudgeAnswers),
    })
    expect(row.error).toBeNull()
    expect(row.actual?.notify).toBe(true)
  })

  test('records an unreadable recorded state as an errored row', async () => {
    const [item] = fixtureItems()
    if (item === undefined) throw new Error('fixture is empty')
    const broken = { ...item, input: { state: '{"scope":{}}' } }
    const row = await runJevRealItem({
      item: broken,
      policies: [singleResponsibilityPolicy],
      decide: decideWith(nudgeAnswers),
    })
    expect(row.actual).toBeNull()
    expect(row.error).not.toBeNull()
  })
})
