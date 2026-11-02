import { describe, expect, it } from 'bun:test'

import { EToolEffect } from '@dltech/atlas-core'

import { filteredToolRegistry, InMemoryToolRegistry } from '../../../tools/registry'
import { toolNamed } from '../../../tools/__tests__/fixtures'
import { AGENT_TOOL_NAMES, WORKTREE_TOOL_NAMES } from '../agent-type'

const named = (name: string) =>
  toolNamed({
    name,
    effect: EToolEffect.Read,
    invoke: async () => ({ ok: true as const, output: '', modelText: 'rendered' }),
  })

const wholeToolset = () =>
  new InMemoryToolRegistry([
    named('read'),
    named('bash'),
    named('enter_worktree'),
    named('exit_worktree'),
    named('worktree_list'),
    named('agent_spawn'),
    named('subscribe'),
  ])

const asAChildSees = () =>
  filteredToolRegistry({
    registry: wholeToolset(),
    deny: [...AGENT_TOOL_NAMES, 'subscribe'],
  })

describe('who may reshape the session', () => {
  it('offers the worktree tools to the agent the developer is talking to', () => {
    const offered = wholeToolset()
      .declarations()
      .map((declaration) => declaration.name)

    expect(offered).toContain('enter_worktree')
    expect(offered).toContain('exit_worktree')
    expect(offered).toContain('worktree_list')
  })

  it('offers them to a child too, which moves only itself', () => {
    const offered = asAChildSees()
      .declarations()
      .map((declaration) => declaration.name)

    expect(offered).toEqual(['read', 'bash', ...WORKTREE_TOOL_NAMES])
  })

  it('withholds subscribe from a child, whose parent owns the pull request', () => {
    const child = asAChildSees()

    expect(child.find('subscribe')).toBeUndefined()
    expect(child.find('agent_spawn')).toBeUndefined()
  })
})
