import { describe, expect, test } from 'bun:test'

import { EAgentDisplay } from '@dltech/atlas-ui/ai/agent-status'
import { EToolKind } from '@dltech/atlas-ui/ai/tool'

import { EAgentStatus, ESandboxState, TEAMMATES } from '../../shell/fixtures/teammates'
import { agentsFor } from '../agent-fixtures'
import { isLiveAgent, latestCallLine } from '../agent-run'
import { ESessionState } from '../session-types'
import { teammateSessionState } from '../teammate-view'

describe('latestCallLine', () => {
  test('says Starting before the first call', () => {
    expect(latestCallLine([])).toBe('Starting')
  })

  test('phrases the last call as running', () => {
    const line = latestCallLine([
      { kind: EToolKind.Read, label: 'a.ts' },
      { kind: EToolKind.Read, label: 'b.ts' },
    ])
    expect(line).toContain('b.ts')
    expect(line).not.toContain('a.ts')
  })
})

describe('agentsFor', () => {
  test('keeps two agents live while the thread runs and settles them when idle', () => {
    expect(agentsFor(ESessionState.Running).filter(isLiveAgent)).toHaveLength(2)
    expect(agentsFor(ESessionState.Idle).filter(isLiveAgent)).toHaveLength(0)
  })

  test('includes an agent with hundreds of calls and a failed one', () => {
    const agents = agentsFor(ESessionState.Running)
    expect(Math.max(...agents.map((agent) => agent.calls.length))).toBeGreaterThan(200)
    expect(agents.some((agent) => agent.display === EAgentDisplay.Failed)).toBe(true)
  })
})

describe('teammateSessionState', () => {
  const byId = (id: string) => TEAMMATES.find((teammate) => teammate.id === id)

  test('maps live, approval and settled teammates', () => {
    const running = byId('tm-theme-gen')
    const blocked = byId('tm-gutter-tokens')
    const done = byId('tm-legacy-home')
    if (!running || !blocked || !done) throw new Error('missing fixture')
    expect(teammateSessionState(running)).toBe(ESessionState.Running)
    expect(teammateSessionState(blocked)).toBe(ESessionState.ApprovalPending)
    expect(teammateSessionState(done)).toBe(ESessionState.Idle)
  })

  test('a booting sandbox reads as running', () => {
    const booting = TEAMMATES.find((teammate) => teammate.sandbox === ESandboxState.Booting)
    if (!booting) throw new Error('missing fixture')
    expect(booting.run).toBe(EAgentStatus.Running)
    expect(teammateSessionState(booting)).toBe(ESessionState.Running)
  })
})
