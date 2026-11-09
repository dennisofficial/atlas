import { describe, expect, it } from 'bun:test'

import { ECommandGroup, ECommandTiming } from '@dltech/atlas-core'

import { resetPeerBudgetArgs, sessionsCoreSlots } from '..'

describe('the sessions core slots', () => {
  it('contributes one command, the peer budget reset', () => {
    expect(sessionsCoreSlots.commands.map((command) => command.spec.name)).toEqual([
      'reset-peer-budget',
    ])
  })

  it('contributes no events and no views', () => {
    expect(sessionsCoreSlots.events).toEqual([])
    expect(sessionsCoreSlots.views).toEqual([])
  })
})

describe('reset-peer-budget', () => {
  const [command] = sessionsCoreSlots.commands

  it('is handled in the control plane, so the route names the peer', () => {
    expect(command?.spec.handledIn).toBe('control')
    expect(command?.spec.timing).toBe(ECommandTiming.Settled)
    expect(command?.spec.group).toBe(ECommandGroup.Session)
  })

  it('tells the operator it gives the peer another twenty messages', () => {
    expect(command?.spec.summary).toContain('20')
    expect(command?.spec.summary).toContain('peer')
  })

  it('takes no arguments of its own', () => {
    expect(resetPeerBudgetArgs.parse({})).toEqual({})
    expect(resetPeerBudgetArgs.safeParse({ sessionId: 'peer-1' }).success).toBe(false)
  })

  it('reaches the pod as a control command inbox kind', () => {
    expect(command?.inboxKind).toBe('command:reset-peer-budget')
  })
})
