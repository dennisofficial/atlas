import { describe, expect, it } from 'bun:test'

import { BUILT_IN_AGENT_TYPES } from '../../../agents/types/built-ins'

import { EnterWorktreeTool } from '../enter-worktree'

describe('the teammate and worktree contracts', () => {
  it('lets the teammate contract authorize the worktree tool', () => {
    const teammate = BUILT_IN_AGENT_TYPES.find((agentType) => agentType.name === 'teammate')
    const tool = new EnterWorktreeTool('/workspace', () => '.atlas/worktrees')

    expect(teammate?.prompt).toContain('own repository worktree')
    expect(tool.description).toContain('your agent contract calls for one')
  })

  it('tells a teammate already inside a worktree how to reach its own', () => {
    const teammate = BUILT_IN_AGENT_TYPES.find((agentType) => agentType.name === 'teammate')
    const tool = new EnterWorktreeTool('/workspace', () => '.atlas/worktrees')

    expect(teammate?.prompt).toContain('Create it with git worktree add')
    expect(teammate?.prompt).toContain('enter it by path with enter_worktree')
    expect(tool.description).toContain('a teammate whose contract calls for its own worktree creates it with git worktree add')
    expect(tool.description).toContain('adopts it here by path')
  })
})
