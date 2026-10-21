import { describe, expect, it } from 'vitest'

import { EWebSearchBackend } from '@dltech/atlas-core'

import { createHarnessContainer } from '../create-harness-container'
import { registeredPortToken } from '../injection'
import { WebSearchBackendToken, WorkspaceRoot, WorktreeDirectoryToken } from '../tokens'
import { ToolRegistry } from '../../tools/registry'

describe('resolving the toolset the composition root builds', () => {
  it('constructs every tool, worktree tools included, from the registered tokens', () => {
    const container = createHarnessContainer()
    container.register(WorkspaceRoot, { useValue: '/w' })
    container.register(WorktreeDirectoryToken, { useValue: () => '.atlas/worktrees' })
    container.register(WebSearchBackendToken, { useValue: () => EWebSearchBackend.DuckDuckGo })

    const names = container
      .resolve(registeredPortToken(ToolRegistry))
      .declarations()
      .map((declaration) => declaration.name)

    expect(names).toContain('enter_worktree')
    expect(names).toContain('exit_worktree')
    expect(names).toContain('worktree_list')
    expect(names).toContain('web_fetch')
    expect(names).toContain('web_search')
  })

  it('names the missing token rather than failing somewhere downstream', () => {
    const container = createHarnessContainer()
    container.register(WorkspaceRoot, { useValue: '/w' })

    expect(() => container.resolve(registeredPortToken(ToolRegistry))).toThrow(/WorktreeDirectory/)
  })
})
