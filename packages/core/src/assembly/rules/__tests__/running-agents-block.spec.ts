import { describe, expect, it } from 'bun:test'

import { contextFor, log, operatorSaidAs } from '../../__tests__/log-fixture'
import { messagesFromEvents } from '../messages-from-events'
import { runningAgentsBlock, type RunningAgent } from '../running-agents-block'
import { runningShellsBlock, type RunningShell } from '../running-shells-block'

const anAgent = (over: Partial<RunningAgent> = {}): RunningAgent => ({
  agentId: 'agent-1',
  agentType: 'explore',
  intent: 'audit the backend slice',
  ...over,
})

const aShell = (over: Partial<RunningShell> = {}): RunningShell => ({
  shellId: 'shell-1',
  command: 'bun test',
  awaitingInput: false,
  totalCharacters: 12,
  ...over,
})

const assembleWith = ({
  events,
  agents,
  shells = [],
}: {
  events: ReturnType<typeof log>
  agents: readonly RunningAgent[]
  shells?: readonly RunningShell[]
}) => {
  const ctx = contextFor({ events })
  const withMessages = messagesFromEvents()({ system: [], messages: [] }, ctx)
  const withShells = runningShellsBlock({ runningShells: () => shells })(withMessages, ctx)
  return runningAgentsBlock({ runningAgents: () => agents })(withShells, ctx)
}

const textsOf = (assembled: ReturnType<typeof assembleWith>): string[] =>
  assembled.messages.flatMap((entry) =>
    entry.message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])),
  )

const SPOKEN = log([{ type: 'user-said', text: 'audit the slices' }])

describe('telling the model what it still has out', () => {
  it('says nothing while no sub-agent is running', () => {
    const assembled = assembleWith({ events: SPOKEN, agents: [] })

    expect(textsOf(assembled)).toEqual([operatorSaidAs('audit the slices')])
  })

  it('names every running agent by id and by the intent it was given', () => {
    const assembled = assembleWith({
      events: SPOKEN,
      agents: [anAgent(), anAgent({ agentId: 'agent-2', intent: 'audit the frontend slice' })],
    })

    const tail = textsOf(assembled).at(-1) ?? ''

    expect(tail).toContain('agent-1  explore "audit the backend slice"')
    expect(tail).toContain('agent-2  explore "audit the frontend slice"')
  })

  it('says a sub-agent final answer arrives on its own, with no prohibition on checking', () => {
    const tail = textsOf(assembleWith({ events: SPOKEN, agents: [anAgent()] })).at(-1) ?? ''

    expect(tail).toContain('final answer arrives on its own')
    expect(tail).not.toMatch(/never poll|no sleeping|no polling|agent_list/)
    expect(tail).not.toContain('explicit report')
  })

  it('adds the explicit-report rule only when a teammate is running', () => {
    const tail =
      textsOf(assembleWith({ events: SPOKEN, agents: [anAgent({ agentType: 'teammate' })] })).at(-1) ?? ''

    expect(tail).toContain('reports only when it sends an explicit report')
  })

  it('names ending the turn as the way to wait, rather than leaving waiting undefined', () => {
    const tail = textsOf(assembleWith({ events: SPOKEN, agents: [anAgent()] })).at(-1) ?? ''

    expect(tail).toContain('say what for and end your turn')
    expect(tail).toContain('agent_say({ agentId, text })')
  })

  it('carries the same words while nothing about the agents changes, so a re-read reads as stale', () => {
    const first = textsOf(assembleWith({ events: SPOKEN, agents: [anAgent()] })).at(-1)
    const later = textsOf(
      assembleWith({
        events: log([
          { type: 'user-said', text: 'audit the slices' },
          { type: 'assistant-said', parts: [{ type: 'text', text: 'waiting' }] },
        ]),
        agents: [anAgent()],
      }),
    ).at(-1)

    expect(later).toBe(first)
  })

  it('sits at the tail, after the shells reminder rather than in place of it', () => {
    const texts = textsOf(assembleWith({ events: SPOKEN, agents: [anAgent()], shells: [aShell()] }))

    expect(texts.at(-2)).toContain('These background shells are still running')
    expect(texts.at(-1)).toContain('These sub-agents you spawned are still running')
  })

  it('holds its tongue when there is no event to anchor to', () => {
    const assembled = assembleWith({ events: log([]), agents: [anAgent()] })

    expect(textsOf(assembled)).toEqual([])
  })
})

describe('the running-shells reminder guidance', () => {
  it('says endings arrive automatically without a polling prohibition', () => {
    const tail =
      textsOf(assembleWith({ events: SPOKEN, agents: [], shells: [aShell()] })).at(-1) ?? ''

    expect(tail).toContain('ending arrives automatically')
    expect(tail).toContain('shell_kill({ shellId })')
    expect(tail).not.toMatch(/never poll|no sleeping|no polling/)
  })
})
