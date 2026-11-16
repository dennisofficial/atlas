import { describe, expect, it } from 'bun:test'

import { routineCreateInputSchema, routineUpdateInputSchema } from '../api'

const created = {
  projectId: 'p1',
  name: 'Digest',
  prompt: 'Run it',
  cron: '0 7 * * *',
  timezone: 'UTC',
}

describe('routine model refs', () => {
  it('refuses a bare model id on create and on update', () => {
    expect(
      routineCreateInputSchema.safeParse({ ...created, model: 'claude-sonnet-4-6' }).success,
    ).toBe(false)
    expect(
      routineUpdateInputSchema.safeParse({ routineId: 'rte-1', model: 'claude-sonnet-4-6' })
        .success,
    ).toBe(false)
  })

  it('accepts a provider/model ref and a null model', () => {
    const ref = 'anthropic/claude-opus-5-5'
    expect(routineCreateInputSchema.safeParse({ ...created, model: ref }).success).toBe(true)
    expect(routineUpdateInputSchema.safeParse({ routineId: 'rte-1', model: ref }).success).toBe(
      true,
    )
    expect(routineCreateInputSchema.safeParse({ ...created, model: null }).success).toBe(true)
    expect(routineUpdateInputSchema.safeParse({ routineId: 'rte-1', model: null }).success).toBe(
      true,
    )
  })
})
