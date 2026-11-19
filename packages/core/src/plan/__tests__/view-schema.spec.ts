import { describe, expect, it } from 'bun:test'

import { EPlanStatus } from '../plan'
import { planViewSchema, type PlanViewState } from '../view'

const state: PlanViewState = {
  tasks: [
    { ordinal: 1, text: 'read', status: EPlanStatus.Completed },
    { ordinal: 2, text: 'write', status: EPlanStatus.InProgress, activeForm: 'writing' },
  ],
  pending: {
    'call-1': [{ ordinal: 1, text: 'ship', status: EPlanStatus.Pending }],
  },
}

describe('the plan view state on the wire', () => {
  it('round-trips a state with tasks and a pending call', () => {
    expect(planViewSchema.parse(JSON.parse(JSON.stringify(state)))).toEqual(state)
  })

  it('rejects an ordinal below one', () => {
    const bad = { ...state, tasks: [{ ordinal: 0, text: 'read', status: EPlanStatus.Pending }] }
    expect(planViewSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects a state with no pending record', () => {
    expect(planViewSchema.safeParse({ tasks: [] }).success).toBe(false)
  })
})
