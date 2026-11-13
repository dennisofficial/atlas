import { describe, expect, it } from 'bun:test'

import { EAgentStatus, EReportKind, toThreadId } from '@dltech/atlas-core'
import {
  type PluginPodContext,
  type PodCrew,
  type SubagentSnapshot,
  EMPTY_CREW,
  EMPTY_MCP_CONTROL,
  EMPTY_OPERATOR_INPUT,
  EMPTY_SESSIONS,
  EMPTY_WORKTREES,
} from '@dltech/atlas-plugin-sdk'

import { CREW_AGENT_TYPES, crewAgentTypeOf } from '../../core'
import { crewPod } from '..'

const startedAt = '2026-11-09T10:00:00.000Z'

const snapshotOf = (overrides: Partial<SubagentSnapshot> = {}): SubagentSnapshot => ({
  agentId: 'a1',
  agentType: 'general-purpose',
  intent: 'trace the port',
  status: EAgentStatus.Running,
  turns: 0,
  toolCalls: 0,
  startedAt,
  ...overrides,
})

type Call = { method: string; args: unknown }

const fakeCrew = (args: { queued?: boolean; held?: readonly SubagentSnapshot[] } = {}) => {
  const calls: Call[] = []
  const port: PodCrew = {
    spawn: async (spawnArgs) => {
      calls.push({ method: 'spawn', args: spawnArgs })
      return snapshotOf({ agentType: spawnArgs.agentType, intent: spawnArgs.intent })
    },
    say: async (sayArgs) => {
      calls.push({ method: 'say', args: sayArgs })
      return { queued: args.queued ?? true, snapshot: snapshotOf({ agentId: sayArgs.agentId }) }
    },
    stop: async (stopArgs) => {
      calls.push({ method: 'stop', args: stopArgs })
      return snapshotOf({ agentId: stopArgs.agentId, status: EAgentStatus.Stopped })
    },
    list: () => args.held ?? [],
    report: async (reportArgs) => {
      calls.push({ method: 'report', args: reportArgs })
      return snapshotOf({ agentId: 'main' })
    },
  }
  return { port, calls }
}

const rig = (crew: PodCrew) => {
  const ctx: PluginPodContext = {
    sessionId: 's1',
    crew,
    sessions: EMPTY_SESSIONS,
    worktrees: EMPTY_WORKTREES,
    control: {
      mcp: EMPTY_MCP_CONTROL,
      operator: EMPTY_OPERATOR_INPUT,
      webSearch: { config: async () => ({ backend: undefined, key: undefined }) },
      exposePort: async () => {
        throw new Error('this rig exposes no port')
      },
      memory: {
        list: async () => ({ project: null, memories: [] }),
        read: async () => null,
        write: async () => {
          throw new Error('this rig writes no memory')
        },
        edit: async () => {
          throw new Error('this rig edits no memory')
        },
        delete: async () => false,
      },
    },
    append: async () => undefined,
    events: () => [],
    call: async () => {
      throw new Error('this rig calls no daemon')
    },
    live: () => undefined,
    onDaemonEvent: () => () => undefined,
    log: () => undefined,
  }
  return { ctx }
}

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
  it('declares its five crew tools and three worktree tools, and denies four to a child', () => {
    const { ctx } = rig(fakeCrew().port)
    expect(crewPod.tools?.(ctx).map((tool) => tool.name)).toEqual([
      'agent_spawn',
      'agent_say',
      'agent_stop',
      'agent_list',
      'report_to_main',
      'enter_worktree',
      'exit_worktree',
      'worktree_list',
    ])
    expect(crewPod.childDeny).toEqual(['agent_spawn', 'agent_say', 'agent_stop', 'agent_list'])
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
      'Started a sub-agent.\na1  general-purpose  trace the port\nIt runs in the background, and hands you its answer the moment it stops.',
    )
    expect(outcome.ok && outcome.output).toEqual({
      agentId: 'a1',
      agentType: 'general-purpose',
      intent: 'trace the port',
    })
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

describe('agent_say', () => {
  it('tells the model a mid-step agent queued the message', async () => {
    const crew = fakeCrew({ queued: true })
    const { ctx } = rig(crew.port)
    const outcome = await invoke({
      ctx,
      name: 'agent_say',
      input: { agentId: 'a1', text: 'also check docs' },
    })
    expect(crew.calls).toEqual([
      { method: 'say', args: { agentId: 'a1', text: 'also check docs' } },
    ])
    expect(textOf(outcome)).toBe(
      'Agent a1 is mid-step, so your message is queued and it will read it before its next one.',
    )
  })

  it('tells the model a stopped agent is running again', async () => {
    const crew = fakeCrew({ queued: false })
    const { ctx } = rig(crew.port)
    const outcome = await invoke({ ctx, name: 'agent_say', input: { agentId: 'a1', text: 'more' } })
    expect(textOf(outcome)).toBe(
      'Agent a1 took your message and is running again; its answer reaches you when it stops.',
    )
  })
})

describe('agent_stop', () => {
  it('signals a running agent and says how it ends', async () => {
    const crew = fakeCrew({ held: [snapshotOf({ status: EAgentStatus.Running })] })
    const { ctx } = rig(crew.port)
    const outcome = await invoke({ ctx, name: 'agent_stop', input: { agentId: 'a1' } })
    expect(crew.calls).toEqual([{ method: 'stop', args: { agentId: 'a1' } }])
    expect(textOf(outcome)).toBe(
      'Signalled agent a1 to stop. It ends after the step it is taking, and you will be handed how it ended.',
    )
  })

  it('says nothing was interrupted when the agent had already ended', async () => {
    const crew = fakeCrew({ held: [snapshotOf({ status: EAgentStatus.Finished })] })
    const { ctx } = rig(crew.port)
    const outcome = await invoke({ ctx, name: 'agent_stop', input: { agentId: 'a1' } })
    expect(textOf(outcome)).toBe(
      'Agent a1 had already ended (finished), so nothing was interrupted.',
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

describe('report_to_main', () => {
  it('sends the kind and the text to the parent', async () => {
    const crew = fakeCrew()
    const { ctx } = rig(crew.port)
    const outcome = await invoke({
      ctx,
      name: 'report_to_main',
      input: { kind: EReportKind.Done, text: 'The port is wired.' },
    })
    expect(crew.calls).toEqual([
      { method: 'report', args: { kind: EReportKind.Done, text: 'The port is wired.' } },
    ])
    expect(textOf(outcome)).toBe(
      'Your report is on its way to the main agent. Carry on, or end your turn if there is nothing else to do.',
    )
  })

  it('turns a port with no parent into a refusal', async () => {
    const { ctx } = rig(EMPTY_CREW)
    const outcome = await invoke({
      ctx,
      name: 'report_to_main',
      input: { kind: EReportKind.Progress, text: 'still going' },
    })
    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toBe('this pod has no parent to report to')
  })
})
