import { describe, expect, it } from 'bun:test'

import type { RunAttention } from '@dltech/atlas-client/transcript'
import { ERunRemedy } from '@dltech/atlas-core'

import { runAttentionActionsOf, type RunRemedyHandlers } from '../run-attention-actions'

const calls: string[] = []
const handlers: RunRemedyHandlers = {
  retry: () => calls.push('retry'),
  resume: () => calls.push('resume'),
  fixCredential: () => calls.push('fix'),
  switchModel: () => calls.push('switch'),
  openAgent: (id) => calls.push(`agent:${id}`),
  compact: () => calls.push('compact'),
}

const attentionOf = (remedies: [ERunRemedy, boolean][]): RunAttention => ({
  failure: null,
  message: '',
  failureSeq: 3,
  runId: null,
  remedies: remedies.map(([remedy, enabled]) => ({ remedy, enabled })),
  dismissible: true,
  busyReason: null,
})

const actionsOf = (remedies: [ERunRemedy, boolean][], agentId?: string) =>
  runAttentionActionsOf({ attention: attentionOf(remedies), agentId, handlers })

describe('runAttentionActionsOf', () => {
  it('maps auth remedies to labelled actions with the first primary', () => {
    const actions = actionsOf([
      [ERunRemedy.FixCredential, true],
      [ERunRemedy.Retry, true],
      [ERunRemedy.SwitchModel, true],
    ])

    expect(actions.map((a) => [a.label, a.primary, a.disabled])).toEqual([
      ['Update key', true, false],
      ['Retry', false, false],
      ['Switch model', false, false],
    ])
  })

  it('disables retry and resume when the attention says they are not enabled', () => {
    const actions = actionsOf([
      [ERunRemedy.Retry, false],
      [ERunRemedy.SwitchModel, true],
    ])

    expect(actions.map((a) => a.disabled)).toEqual([true, false])
  })

  it('offers resume alone for an interrupted run', () => {
    expect(actionsOf([[ERunRemedy.Resume, true]]).map((a) => a.label)).toEqual(['Resume'])
  })

  it('offers the agent remedy only with an agent id', () => {
    const remedies: [ERunRemedy, boolean][] = [
      [ERunRemedy.OpenAgent, true],
      [ERunRemedy.Retry, true],
    ]

    expect(actionsOf(remedies).map((a) => a.label)).toEqual(['Retry'])
    const withAgent = actionsOf(remedies, 'agt_1')
    expect(withAgent.map((a) => a.label)).toEqual(['View agent', 'Retry'])
    calls.length = 0
    withAgent[0]?.onSelect()
    expect(calls).toEqual(['agent:agt_1'])
  })
})
