import { describe, expect, it } from 'bun:test'

import {
  RECONCILE_HOLDERS_CRON,
  RECONCILE_HOLDERS_TASK_ID,
  RECONCILE_LIMIT,
  reconcileHoldersPayloadSchema,
} from '../src/reconcile-holders'

describe('reconcile-holders contract', () => {
  it('pins the task id, cron and limit', () => {
    expect(RECONCILE_HOLDERS_TASK_ID).toBe('reconcile-holders')
    expect(RECONCILE_HOLDERS_CRON).toBe('* * * * *')
    expect(RECONCILE_LIMIT).toBe(500)
  })

  it('accepts only the empty payload', () => {
    expect(reconcileHoldersPayloadSchema.safeParse({}).success).toBe(true)
    expect(reconcileHoldersPayloadSchema.safeParse({ limit: 10 }).success).toBe(false)
    expect(reconcileHoldersPayloadSchema.safeParse(null).success).toBe(false)
  })
})
