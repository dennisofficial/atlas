import { describe, expect, it } from 'bun:test'

import type { CommandContext } from '@dltech/atlas-commands'
import { EAgentStatus, EResumeOutcome } from '@dltech/atlas-core'
import type { PodCrew, SubagentSnapshot } from '@dltech/atlas-plugin-sdk'

import { EAgentAction, REFUSAL_AGENT_TEXT, REFUSAL_NO_SUCH_AGENT } from '../../core/commands'
import { agentHandlerOf } from '../commands'
import { fakeCrew, rig, snapshotOf } from './crew-tools-rig'

const contextOf = (args: unknown): CommandContext<unknown> => ({
  args,
  sessionId: 's1',
  inboxId: 7,
  visibleEvents: () => [],
  logEvents: () => [],
  runningChildren: () => 1,
  append: async () => undefined,
  log: () => undefined,
})

const callOf = async (args: { crew: PodCrew; input: unknown }) => {
  const { ctx } = rig(args.crew)
  return await agentHandlerOf(ctx)(contextOf(args.input))
}

const sayingCrew = (answer: Awaited<ReturnType<PodCrew['say']>>): PodCrew => ({
  ...fakeCrew().port,
  say: async () => answer,
})

describe('the agent pod command', () => {
  it('says the text to the named sub-agent', async () => {
    const { port, calls } = fakeCrew()
    const result = await callOf({
      crew: port,
      input: { action: EAgentAction.Say, agentId: 'a1', text: 'take the parser' },
    })
    expect(result).toEqual({ kind: 'done' })
    expect(calls).toEqual([{ method: 'say', args: { agentId: 'a1', text: 'take the parser' } }])
  })

  it('refuses say when the crew knows no such child', async () => {
    const result = await callOf({
      crew: sayingCrew(undefined),
      input: { action: EAgentAction.Say, agentId: 'ghost', text: 'hello' },
    })
    expect(result).toEqual({ kind: 'refused', reason: REFUSAL_NO_SUCH_AGENT })
  })

  it('stops the named sub-agent', async () => {
    const { port, calls } = fakeCrew()
    const result = await callOf({ crew: port, input: { action: EAgentAction.Stop, agentId: 'a1' } })
    expect(result).toEqual({ kind: 'done' })
    expect(calls).toEqual([{ method: 'stop', args: { agentId: 'a1' } }])
  })

  it('treats a child that had already ended as done', async () => {
    const ended: SubagentSnapshot = snapshotOf({ status: EAgentStatus.Stopped })
    const crew: PodCrew = { ...fakeCrew().port, stop: async () => ended }
    expect(await callOf({ crew, input: { action: EAgentAction.Stop, agentId: 'a1' } })).toEqual({
      kind: 'done',
    })
  })

  it('refuses stop with the sentence the crew throws, as the no-such-agent refusal', async () => {
    const crew: PodCrew = {
      ...fakeCrew().port,
      stop: async () => {
        throw new Error('no sub-agent a1 in this session')
      },
    }
    expect(await callOf({ crew, input: { action: EAgentAction.Stop, agentId: 'a1' } })).toEqual({
      kind: 'refused',
      reason: REFUSAL_NO_SUCH_AGENT,
    })
  })

  it('refuses say with no text', async () => {
    const { port, calls } = fakeCrew()
    const result = await callOf({ crew: port, input: { action: EAgentAction.Say, agentId: 'a1' } })
    expect(result).toEqual({ kind: 'refused', reason: REFUSAL_AGENT_TEXT })
    expect(calls).toEqual([])
  })

  it('refuses arguments that do not parse', async () => {
    const result = await callOf({
      crew: fakeCrew().port,
      input: { action: 'delete', agentId: 'a1' },
    })
    expect(result.kind).toBe('refused')
  })

  it('never resumes a child: resume is its own feature', async () => {
    const result = await callOf({
      crew: fakeCrew().port,
      input: { action: 'resume', agentId: 'a1' },
    })
    expect(result.kind).toBe('refused')
    expect(await fakeCrew().port.resume({ agentId: 'a1' })).toBe(EResumeOutcome.Resumed)
  })
})
