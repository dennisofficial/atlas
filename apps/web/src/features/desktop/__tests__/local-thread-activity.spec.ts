import { expect, it } from 'bun:test'

import { localThreadSchema } from '../local-thread-wire'
import { localSummary } from './local-thread-fixture'

const available = () => ({
  ...localSummary,
  activityState: 'available',
  lastAssistantSeq: 3,
})

it('accepts only available activity with known and agreeing assistant and cursor facts', () => {
  const summary = available()
  expect(localThreadSchema.safeParse(summary).success).toBe(true)
  for (const change of [
    { status: undefined },
    { readSeq: undefined },
    { lastAssistantSeq: null },
    { lastAssistantSeq: 2 },
    { readSeq: 2 },
    { reason: 'stale unavailable reason' },
  ]) {
    expect(localThreadSchema.safeParse({ ...summary, ...change }).success).toBe(false)
  }
})

it('keeps unavailable cursor knowledge distinct and forbids stale status', () => {
  const { status, readSeq, ...base } = available()
  const summary = { ...base, activityState: 'unavailable', reason: 'Activity is unsupported' }
  expect(localThreadSchema.parse(summary)).not.toHaveProperty('readSeq')
  expect(localThreadSchema.parse({ ...summary, readSeq: null }).readSeq).toBeNull()
  expect(localThreadSchema.parse({ ...summary, readSeq }).readSeq).toBe(1)
  expect(localThreadSchema.safeParse({ ...summary, status }).success).toBe(false)
  expect(localThreadSchema.safeParse({ ...summary, status: undefined }).success).toBe(false)
  expect(localThreadSchema.safeParse({ ...summary, reason: '   ' }).success).toBe(false)
})
