import { describe, expect, it } from 'bun:test'

import { EAgentStatus, toThreadId } from '@dltech/atlas-core'
import { EMPTY_CREW, type PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { CREW_AGENT_TYPES, crewAgentTypeOf } from '../../core'
import { crewPod } from '..'
import { snapshotOf, fakeCrew, rig } from './crew-tools-rig'

const invoke = async (args: { ctx: PluginPodContext; name: string; input: unknown }) => {
  const tool = crewPod.tools?.(args.ctx).find((candidate) => candidate.name === args.name)
  if (tool === undefined) throw new Error(`no tool ${args.name}`)
  return tool.invoke({
    input: args.input,
    signal: new AbortController().signal,
    idempotencyKey: 'k',
    projectDirectory: '/work',
    threadId: toThreadId('t1'),
  })
}

const textOf = (outcome: Awaited<ReturnType<typeof invoke>>): string =>
  outcome.ok ? outcome.modelText : outcome.reason

describe('the crew pod', () => {
  it('declares its three crew tools and three worktree tools, and denies three to a child', () => {
    const { ctx } = rig(fakeCrew().port)
    expect(crewPod.tools?.(ctx).map((tool) => tool.name)).toEqual([
      'agent_spawn',
      'agent_stop',
      'agent_list',
      'enter_worktree',
      'exit_worktree',
      'worktree_list',
    ])
    expect(crewPod.childDeny).toEqual(['agent_spawn', 'agent_stop', 'agent_list'])
  })
})

describe('agent_spawn', () => {
  it('spawns the type with its contract and the brief, and names it back', async () => {
    const crew = fakeCrew()
    const { ctx } = rig(crew.port)
    const outcome = await invoke({
      ctx,
      name: 'agent_spawn',
      input: {
        agentType: 'general-purpose',
        intent: 'trace the port',
        brief: 'Find where crew.ts is read.',
      },
    })
    expect(outcome.ok).toBe(true)
    expect(crew.calls).toEqual([
      {
        method: 'spawn',
        args: {
          agentType: 'general-purpose',
          intent: 'trace the port',
          prompt: `${crewAgentTypeOf('general-purpose')?.contract}\n\nFind where crew.ts is read.`,
        },
      },
    ])
    expect(textOf(outcome)).toBe(
      'Started a sub-agent.\na1  general-purpose  trace the port\nIt runs in the background. It hands you its answer the moment it stops.',
    )
    expect(outcome.ok && outcome.output).toEqual({
      agentId: 'a1',
      agentType: 'general-purpose',
      intent: 'trace the port',
    })
  })

  it('spawns a researcher with its report-only research contract', async () => {
    const crew = fakeCrew()
    const { ctx } = rig(crew.port)
    const outcome = await invoke({
      ctx,
      name: 'agent_spawn',
      input: { agentType: 'researcher', intent: 'read the docs', brief: 'How does X work?' },
    })
    expect(outcome.ok).toBe(true)
    const contract = crewAgentTypeOf('researcher')?.contract ?? ''
    expect(contract).toContain('Use primary sources')
    expect(contract).toContain('Use your tools only to observe')
    expect(crew.calls).toEqual([
      {
        method: 'spawn',
        args: {
          agentType: 'researcher',
          intent: 'read the docs',
          prompt: `${contract}\n\nHow does X work?`,
        },
      },
    ])
  })

  it('refuses an unknown agent type and lists the known ones', async () => {
    const crew = fakeCrew()
    const { ctx } = rig(crew.port)
    const outcome = await invoke({
      ctx,
      name: 'agent_spawn',
      input: { agentType: 'teammate', intent: 'peer', brief: 'Do the work.' },
    })
    expect(outcome.ok).toBe(false)
    for (const type of CREW_AGENT_TYPES) expect(textOf(outcome)).toContain(type.name)
    expect(crew.calls).toEqual([])
  })

  it('turns a port that cannot spawn into a refusal', async () => {
    const { ctx } = rig(EMPTY_CREW)
    const outcome = await invoke({
      ctx,
      name: 'agent_spawn',
      input: { agentType: 'builder', intent: 'edit', brief: 'Change the file.' },
    })
    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toBe('this pod has no sub-agents')
  })
})

describe('agent_stop', () => {
  it('signals a running agent and says how it ends', async () => {
    const crew = fakeCrew({ held: [snapshotOf({ status: EAgentStatus.Running })] })
    const { ctx } = rig(crew.port)
    const outcome = await invoke({ ctx, name: 'agent_stop', input: { agentId: 'a1' } })
    expect(crew.calls).toEqual([{ method: 'stop', args: { agentId: 'a1' } }])
    expect(textOf(outcome)).toBe(
      'Signalled sub-agent a1 to stop. It ends after the step it is taking. You will be handed how it ended.',
    )
  })

  it('says nothing was interrupted when the agent had already ended', async () => {
    const crew = fakeCrew({ held: [snapshotOf({ status: EAgentStatus.Finished })] })
    const { ctx } = rig(crew.port)
    const outcome = await invoke({ ctx, name: 'agent_stop', input: { agentId: 'a1' } })
    expect(textOf(outcome)).toBe(
      'Sub-agent a1 had already ended (finished), so nothing was interrupted.',
    )
  })
})

describe('agent_list', () => {
  it('says plainly that there are none', async () => {
    const { ctx } = rig(fakeCrew().port)
    const outcome = await invoke({ ctx, name: 'agent_list', input: {} })
    expect(textOf(outcome)).toBe('You have started no sub-agents.')
  })

  it('renders a line per agent with its counts and last tool', async () => {
    const { ctx } = rig(
      fakeCrew({
        held: [
          snapshotOf({ turns: 2, toolCalls: 3, lastTool: 'read_file' }),
          snapshotOf({
            agentId: 'a2',
            agentType: 'reviewer',
            intent: 'review the diff',
            status: EAgentStatus.Finished,
            turns: 5,
            toolCalls: 9,
          }),
        ],
      }).port,
    )
    const outcome = await invoke({ ctx, name: 'agent_list', input: {} })
    expect(textOf(outcome)).toBe(
      [
        'a1  general-purpose  trace the port  running, turns 2, tool calls 3, last tool read_file',
        'a2  reviewer  review the diff  finished, turns 5, tool calls 9',
      ].join('\n'),
    )
  })
})
