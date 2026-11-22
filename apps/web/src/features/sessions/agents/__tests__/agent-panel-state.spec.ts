import { describe, expect, it } from 'bun:test'

import { ESessionConnection } from '@dltech/atlas-client/stream'

import { EAgentPanelState, agentPanelStateOf } from '../agent-panel-state'

describe('agentPanelStateOf', () => {
  it('loads while a child snapshot has no events and is not live', () => {
    expect(
      agentPanelStateOf({
        events: [],
        error: undefined,
        connection: ESessionConnection.Reconnecting,
      }),
    ).toBe(EAgentPanelState.Loading)
  })

  it('reads the transcript once events arrive', () => {
    expect(
      agentPanelStateOf({
        events: [{ seq: 1 }] as never,
        error: undefined,
        connection: ESessionConnection.CatchingUp,
      }),
    ).toBe(EAgentPanelState.Ready)
  })

  it('shows the error state over everything else', () => {
    expect(
      agentPanelStateOf({
        events: [],
        error: 'not-found' as never,
        connection: ESessionConnection.Live,
      }),
    ).toBe(EAgentPanelState.Error)
  })
})
