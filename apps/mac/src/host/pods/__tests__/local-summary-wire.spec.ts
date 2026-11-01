import { expect, test } from 'bun:test'
import { localThreadSchema } from '../wire'

const base = {
  threadId: 'root',
  projectId: null,
  head: 4,
  createdAt: 'now',
  updatedAt: 'now',
  lastAssistantSeq: 3,
}
const status = {
  working: false,
  awaiting: null,
  lastOutcome: null,
  podState: 'parked',
  lastAssistantSeq: 3,
  readSeq: null,
}

test('local summary union rejects stale status and disagreement with known base facts', () => {
  expect(
    localThreadSchema.safeParse({ ...base, activityState: 'available', readSeq: null, status })
      .success,
  ).toBe(true)
  expect(
    localThreadSchema.safeParse({ ...base, activityState: 'available', readSeq: 2, status })
      .success,
  ).toBe(false)
  expect(
    localThreadSchema.safeParse({
      ...base,
      activityState: 'available',
      lastAssistantSeq: null,
      readSeq: null,
      status,
    }).success,
  ).toBe(false)
  expect(
    localThreadSchema.safeParse({
      ...base,
      activityState: 'unavailable',
      reason: 'Activity unavailable',
      status,
    }).success,
  ).toBe(false)
  const unknown = localThreadSchema.parse({
    ...base,
    activityState: 'unavailable',
    reason: 'Activity unavailable',
  })
  expect('readSeq' in unknown).toBe(false)
  expect(
    localThreadSchema.parse({
      ...base,
      activityState: 'unavailable',
      readSeq: null,
      reason: 'Activity unavailable',
    }).readSeq,
  ).toBeNull()
})
