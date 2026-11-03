import { describe, expect, it } from 'bun:test'

import {
  V2_RECONCILE_HOLDERS_CRON,
  V2_RECONCILE_HOLDERS_TASK_ID,
  V2_RECONCILE_LIMIT,
  v2ReconcileHoldersPayloadSchema,
} from '../src/v2-reconcile-holders'

describe('v2-reconcile-holders contract', () => {
  it('pins the task id, cron and limit', () => {
    expect(V2_RECONCILE_HOLDERS_TASK_ID).toBe('v2-reconcile-holders')
    expect(V2_RECONCILE_HOLDERS_CRON).toBe('* * * * *')
    expect(V2_RECONCILE_LIMIT).toBe(500)
  })

  it('accepts only the empty payload', () => {
    expect(v2ReconcileHoldersPayloadSchema.safeParse({}).success).toBe(true)
    expect(v2ReconcileHoldersPayloadSchema.safeParse({ limit: 10 }).success).toBe(false)
    expect(v2ReconcileHoldersPayloadSchema.safeParse(null).success).toBe(false)
  })
})
