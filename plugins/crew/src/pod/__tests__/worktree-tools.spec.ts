import { describe, expect, it } from 'bun:test'

import {
  EAgentStatus,
  EWorktreeExit,
  toThreadId,
  type ActiveWorktree,
  type V2Event,
} from '@dltech/atlas-core'
import {
  EMPTY_CREW,
  type PluginPodContext,
  type PodCrew,
  type PodWorktrees,
  type SubagentSnapshot,
  type WorktreeListing,
  type WorktreeState,
} from '@dltech/atlas-plugin-sdk'

import { crewPod } from '..'

const startedAt = '2026-11-09T10:00:00.000Z'

const listing: WorktreeListing = {
  repository: '/work',
  worktrees: [
    { path: '/work', branch: 'main', isMain: true, bare: false, detached: false, prunable: false },
    {
      path: '/work/.atlas/worktrees/dennis/wt',
      branch: 'dennis/wt',
      isMain: false,
      bare: false,
      detached: false,
      prunable: false,
    },
    {
      path: '/work/.atlas/worktrees/dennis/detached',
      branch: null,
      isMain: false,
      bare: false,
      detached: true,
      prunable: false,
    },
  ],
}

const cleanState: WorktreeState = {
  isClean: true,
  changedPaths: [],
  changedCount: 0,
  unpushedCommits: 0,
  upstream: undefined,
  base: undefined,
  behind: undefined,
}

const dirtyState: WorktreeState = {
  ...cleanState,
  isClean: false,
  changedPaths: ['src/a.ts'],
  changedCount: 1,
}

type Call = { method: string; args: unknown }

const snapshotOf = (overrides: Partial<SubagentSnapshot> = {}): SubagentSnapshot => ({
  agentId: 'a1',
  agentType: 'general-purpose',
  intent: 'work the branch',
  status: EAgentStatus.Running,
  turns: 0,
  toolCalls: 0,
  startedAt,
  ...overrides,
})

const fakeCrew = () => {
  const calls: Call[] = []
  const port: PodCrew = {
    ...EMPTY_CREW,
    spawn: async (args) => {
      calls.push({ method: 'spawn', args })
      return snapshotOf({
        worktree:
          args.worktree === undefined
            ? undefined
            : { path: args.worktree.path, branch: args.worktree.branch },
      })
    },
  }
  return { port, calls }
}

const fakeWorktrees = (args: { state?: WorktreeState } = {}) => {
  const calls: Call[] = []
  const port: PodWorktrees = {
    list: async (listArgs) => {
      calls.push({ method: 'list', args: listArgs })
      return listing
    },
    create: async (createArgs) => {
      calls.push({ method: 'create', args: createArgs })
      return {
        path: `/work/.atlas/worktrees/${createArgs.name}`,
        branch: createArgs.name,
        base: 'origin/main',
      }
    },
    inspect: async (inspectArgs) => {
      calls.push({ method: 'inspect', args: inspectArgs })
      return args.state ?? cleanState
    },
    remove: async (removeArgs) => {
      calls.push({ method: 'remove', args: removeArgs })
      return { branch: removeArgs.branch, branchDeleted: true }
    },
  }
  return { port, calls }
}

const rig = (
  args: { worktrees?: PodWorktrees; crew?: PodCrew; events?: readonly V2Event[] } = {},
) => {
  const ctx: PluginPodContext = {
    sessionId: 's1',
    crew: args.crew ?? fakeCrew().port,
    worktrees: args.worktrees ?? fakeWorktrees().port,
    control: {
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
    events: () => args.events ?? [],
    call: async () => {
      throw new Error('this rig calls no daemon')
    },
    onDaemonEvent: () => () => undefined,
    log: () => undefined,
  }
  return { ctx }
}

const invoke = async (args: {
  ctx: PluginPodContext
  name: string
  input: unknown
  projectDirectory?: string
  activeWorktree?: ActiveWorktree
}) => {
  const tool = crewPod.tools?.(args.ctx).find((candidate) => candidate.name === args.name)
  if (tool === undefined) throw new Error(`no tool ${args.name}`)
  return tool.invoke({
    input: args.input,
    signal: new AbortController().signal,
    idempotencyKey: 'k',
    projectDirectory: args.projectDirectory ?? '/work',
    activeWorktree: args.activeWorktree,
    threadId: toThreadId('t1'),
  })
}

const inWorktree: ActiveWorktree = {
  path: '/work/.atlas/worktrees/dennis/wt',
  branch: 'dennis/wt',
  base: 'origin/main',
  adopted: false,
}

describe('the worktree tools', () => {
  it('ships beside the five crew tools and tracks its own events', () => {
    const { ctx } = rig()
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
    expect(crewPod.hooks?.(ctx).afterTool?.map((hook) => hook.name)).toEqual([
      'crew-worktree-track',
    ])
  })
})

describe('enter_worktree', () => {
  it('creates a branch and a worktree named by the tool', async () => {
    const worktrees = fakeWorktrees()
    const { ctx } = rig({ worktrees: worktrees.port })
    const outcome = await invoke({ ctx, name: 'enter_worktree', input: { name: 'dennis/new' } })

    expect(outcome.ok).toBe(true)
    expect(worktrees.calls).toEqual([
      { method: 'create', args: { cwd: '/work', name: 'dennis/new' } },
    ])
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(outcome.output).toEqual({
      enteredWorktree: {
        path: '/work/.atlas/worktrees/dennis/new',
        branch: 'dennis/new',
        base: 'origin/main',
      },
    })
  })

  it('refuses name and path together, and neither', async () => {
    const { ctx } = rig()
    const both = await invoke({
      ctx,
      name: 'enter_worktree',
      input: { name: 'a', path: '/work/.atlas/worktrees/dennis/wt' },
    })
    const neither = await invoke({ ctx, name: 'enter_worktree', input: {} })

    expect(both.ok ? '' : both.reason).toContain('exactly one')
    expect(neither.ok ? '' : neither.reason).toContain('pass name')
  })

  it('enters an existing worktree by a path relative to the project directory', async () => {
    const { ctx } = rig()
    const outcome = await invoke({
      ctx,
      name: 'enter_worktree',
      input: { path: '.atlas/worktrees/dennis/wt' },
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(outcome.output).toEqual({
      enteredWorktree: {
        path: '/work/.atlas/worktrees/dennis/wt',
        branch: 'dennis/wt',
        adopted: true,
      },
    })
  })

  it('treats a worktree this session spawned a child into as one Atlas created', async () => {
    const worktrees = fakeWorktrees()
    const spawnedInto = {
      type: 'agent-spawned',
      agentId: 'a1',
      agentType: 'general-purpose',
      intent: 'work the branch',
      mode: 'fresh',
      worktree: { path: '/work/.atlas/worktrees/dennis/wt', branch: 'dennis/wt' },
    } as unknown as V2Event
    const { ctx } = rig({ worktrees: worktrees.port, events: [spawnedInto] })

    const entered = await invoke({
      ctx,
      name: 'enter_worktree',
      input: { path: '/work/.atlas/worktrees/dennis/wt' },
    })

    expect(entered.ok).toBe(true)
    if (!entered.ok) throw new Error(entered.reason)
    expect(entered.output).toMatchObject({ enteredWorktree: { adopted: false } })
    expect(entered.modelText).toContain('which this session created')
  })

  it('refuses the main checkout, a detached HEAD and a path git does not list', async () => {
    const { ctx } = rig()
    const main = await invoke({ ctx, name: 'enter_worktree', input: { path: '/work' } })
    const detached = await invoke({
      ctx,
      name: 'enter_worktree',
      input: { path: '/work/.atlas/worktrees/dennis/detached' },
    })
    const stranger = await invoke({
      ctx,
      name: 'enter_worktree',
      input: { path: '/work/elsewhere' },
    })

    expect(main.ok ? '' : main.reason).toContain('main checkout')
    expect(detached.ok ? '' : detached.reason).toContain('detached HEAD')
    expect(stranger.ok ? '' : stranger.reason).toContain('is not a worktree git lists')
  })

  it('refuses a second worktree while the session is in one', async () => {
    const { ctx } = rig()
    const outcome = await invoke({
      ctx,
      name: 'enter_worktree',
      input: { name: 'dennis/another' },
      activeWorktree: inWorktree,
    })

    expect(outcome.ok ? '' : outcome.reason).toContain('already in the worktree')
  })

  it('refuses a name git could not use', async () => {
    const { ctx } = rig()
    const outcome = await invoke({ ctx, name: 'enter_worktree', input: { name: 'has spaces' } })
    expect(outcome.ok ? '' : outcome.reason).toContain('not a usable worktree name')
  })
})

describe('exit_worktree', () => {
  it('says so and changes nothing when the session is not in a worktree', async () => {
    const worktrees = fakeWorktrees()
    const { ctx } = rig({ worktrees: worktrees.port })
    const outcome = await invoke({ ctx, name: 'exit_worktree', input: { action: 'keep' } })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(outcome.output).toEqual({ exited: false })
    expect(worktrees.calls).toEqual([])
  })

  it('leaves the worktree on disk on keep', async () => {
    const worktrees = fakeWorktrees()
    const { ctx } = rig({ worktrees: worktrees.port })
    const outcome = await invoke({
      ctx,
      name: 'exit_worktree',
      input: { action: 'keep' },
      projectDirectory: inWorktree.path,
      activeWorktree: inWorktree,
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(outcome.output).toEqual({
      exitedWorktree: { path: inWorktree.path, action: EWorktreeExit.Keep, returnTo: '/work' },
    })
    expect(worktrees.calls.some((call) => call.method === 'remove')).toBe(false)
  })

  it('removes the worktree and its branch when it is clean', async () => {
    const worktrees = fakeWorktrees()
    const { ctx } = rig({ worktrees: worktrees.port })
    const outcome = await invoke({
      ctx,
      name: 'exit_worktree',
      input: { action: 'remove' },
      projectDirectory: inWorktree.path,
      activeWorktree: inWorktree,
    })

    expect(outcome.ok).toBe(true)
    expect(worktrees.calls).toContainEqual({
      method: 'remove',
      args: {
        cwd: '/work',
        path: inWorktree.path,
        branch: 'dennis/wt',
        force: false,
      },
    })
  })

  it('refuses to remove a dirty worktree and names what would be lost', async () => {
    const worktrees = fakeWorktrees({ state: dirtyState })
    const { ctx } = rig({ worktrees: worktrees.port })
    const outcome = await invoke({
      ctx,
      name: 'exit_worktree',
      input: { action: 'remove' },
      projectDirectory: inWorktree.path,
      activeWorktree: inWorktree,
    })

    expect(outcome.ok ? '' : outcome.reason).toContain('would lose 1 uncommitted file (src/a.ts)')
    expect(worktrees.calls.some((call) => call.method === 'remove')).toBe(false)
  })

  it('removes a dirty worktree only when discardChanges is set', async () => {
    const worktrees = fakeWorktrees({ state: dirtyState })
    const { ctx } = rig({ worktrees: worktrees.port })
    const outcome = await invoke({
      ctx,
      name: 'exit_worktree',
      input: { action: 'remove', discardChanges: true },
      projectDirectory: inWorktree.path,
      activeWorktree: inWorktree,
    })

    expect(outcome.ok).toBe(true)
    expect(worktrees.calls).toContainEqual({
      method: 'remove',
      args: { cwd: '/work', path: inWorktree.path, branch: 'dennis/wt', force: true },
    })
  })

  it('never removes a worktree Atlas only adopted', async () => {
    const worktrees = fakeWorktrees()
    const { ctx } = rig({ worktrees: worktrees.port })
    const outcome = await invoke({
      ctx,
      name: 'exit_worktree',
      input: { action: 'remove' },
      projectDirectory: inWorktree.path,
      activeWorktree: { ...inWorktree, adopted: true },
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(outcome.modelText).toContain('Atlas did not create it')
    expect(worktrees.calls.some((call) => call.method === 'remove')).toBe(false)
  })
})

describe('worktree_list', () => {
  it('marks the main checkout and the worktree the session stands in', async () => {
    const { ctx } = rig()
    const outcome = await invoke({
      ctx,
      name: 'worktree_list',
      input: {},
      projectDirectory: inWorktree.path,
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(outcome.output).toEqual({
      repository: '/work',
      current: inWorktree.path,
      worktrees: [
        { path: '/work', branch: 'main', isMain: true },
        { path: '/work/.atlas/worktrees/dennis/wt', branch: 'dennis/wt', isMain: false },
        { path: '/work/.atlas/worktrees/dennis/detached', branch: null, isMain: false },
      ],
    })
    expect(outcome.modelText).toContain('/work on main (main checkout)')
    expect(outcome.modelText).toContain(
      '/work/.atlas/worktrees/dennis/wt on dennis/wt (this session)',
    )
  })
})

describe('agent_spawn with a worktree', () => {
  it('creates the named worktree and spawns the child into it', async () => {
    const crew = fakeCrew()
    const worktrees = fakeWorktrees()
    const { ctx } = rig({ crew: crew.port, worktrees: worktrees.port })
    const outcome = await invoke({
      ctx,
      name: 'agent_spawn',
      input: {
        agentType: 'general-purpose',
        intent: 'work the branch',
        brief: 'Do the thing.',
        worktree: 'dennis/child',
      },
    })

    expect(outcome.ok).toBe(true)
    expect(worktrees.calls).toContainEqual({
      method: 'create',
      args: { cwd: '/work', name: 'dennis/child' },
    })
    const spawn = crew.calls.find((call) => call.method === 'spawn')
    expect(spawn?.args).toMatchObject({
      worktree: {
        path: '/work/.atlas/worktrees/dennis/child',
        branch: 'dennis/child',
        base: 'origin/main',
      },
    })
    expect(outcome.ok ? outcome.modelText : '').toContain(
      'It works in /work/.atlas/worktrees/dennis/child on branch dennis/child.',
    )
  })

  it('adopts an existing worktree when the argument matches one git lists', async () => {
    const crew = fakeCrew()
    const { ctx } = rig({ crew: crew.port })
    const outcome = await invoke({
      ctx,
      name: 'agent_spawn',
      input: {
        agentType: 'general-purpose',
        intent: 'work the branch',
        brief: 'Do the thing.',
        worktree: '/work/.atlas/worktrees/dennis/wt',
      },
    })

    expect(outcome.ok).toBe(true)
    const spawn = crew.calls.find((call) => call.method === 'spawn')
    expect(spawn?.args).toMatchObject({
      worktree: { path: '/work/.atlas/worktrees/dennis/wt', adopted: true },
    })
  })

  it('refuses to spawn when the worktree cannot be entered', async () => {
    const crew = fakeCrew()
    const { ctx } = rig({ crew: crew.port })
    const outcome = await invoke({
      ctx,
      name: 'agent_spawn',
      input: {
        agentType: 'general-purpose',
        intent: 'work the branch',
        brief: 'Do the thing.',
        worktree: '/work',
      },
    })

    expect(outcome.ok ? '' : outcome.reason).toContain('main checkout')
    expect(crew.calls).toEqual([])
  })
})
