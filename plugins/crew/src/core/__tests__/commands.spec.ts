import { describe, expect, it } from 'bun:test'

import { ECommandGroup, ECommandRunsIn, type TextArgs } from '@dltech/atlas-commands'

import {
  AGENT_TEXT_LIMIT,
  agent,
  agentArgs,
  EAgentAction,
  REFUSAL_AGENT_ACTION,
  REFUSAL_AGENT_TEXT,
} from '../commands'

const argsOf = (argumentText: string): TextArgs =>
  agent.spec.fromText?.(argumentText) ?? { ok: false, reason: 'no fromText' }

const refusedWith = (argumentText: string): string | undefined => {
  const parsed = argsOf(argumentText)
  return parsed.ok ? undefined : parsed.reason
}

describe('the agent command', () => {
  it('is a host command in the session group', () => {
    expect(agent.spec.name).toBe('agent')
    expect(agent.spec.group).toBe(ECommandGroup.Session)
    expect(agent.spec.runsIn).toBe(ECommandRunsIn.Host)
    expect(agent.inboxKind).toBe('command:agent')
  })

  it('reads say with an id and the text that follows', () => {
    expect(argsOf('say a1 take the parser')).toEqual({
      ok: true,
      args: { action: EAgentAction.Say, agentId: 'a1', text: 'take the parser' },
    })
  })

  it('keeps the text after the id verbatim', () => {
    expect(argsOf('say a1 fix the lexer\nand the parser')).toEqual({
      ok: true,
      args: { action: EAgentAction.Say, agentId: 'a1', text: 'fix the lexer\nand the parser' },
    })
  })

  it('reads stop with an id', () => {
    expect(argsOf('stop a1')).toEqual({
      ok: true,
      args: { action: EAgentAction.Stop, agentId: 'a1' },
    })
  })

  it('refuses an unknown action', () => {
    expect(refusedWith('delete a1')).toBe(REFUSAL_AGENT_ACTION)
  })

  it('refuses say with no text', () => {
    expect(refusedWith('say a1')).toBe(REFUSAL_AGENT_TEXT)
    expect(refusedWith('say a1   ')).toBe(REFUSAL_AGENT_TEXT)
  })

  it('refuses a line with no id', () => {
    expect(refusedWith('say')).toBe(REFUSAL_AGENT_ACTION)
    expect(refusedWith('')).toBe(REFUSAL_AGENT_ACTION)
  })

  it('refuses text past the cap', () => {
    const parsed = agentArgs.safeParse({
      action: EAgentAction.Say,
      agentId: 'a1',
      text: 'x'.repeat(AGENT_TEXT_LIMIT + 1),
    })
    expect(parsed.success).toBe(false)
  })

  it('accepts text at the cap', () => {
    const parsed = agentArgs.safeParse({
      action: EAgentAction.Say,
      agentId: 'a1',
      text: 'x'.repeat(AGENT_TEXT_LIMIT),
    })
    expect(parsed.success).toBe(true)
  })
})
