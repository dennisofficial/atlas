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
    named('service_start'),
    named('service_stop'),
    named('service_list'),
    named('read'),
    named('bash'),
  ])

const asAChildSees = () =>
  filteredToolRegistry({
    registry: wholeToolset(),
    deny: [...AGENT_TOOL_NAMES, ...WORKTREE_TOOL_NAMES, 'operator_input'],
  })

describe('what a child may do with the session’s services', () => {
  it('keeps start, stop and list: services are session-wide infrastructure any thread may operate', () => {
    const child = asAChildSees()

    expect(child.find('service_start')).toBeDefined()
    expect(child.find('service_stop')).toBeDefined()
    expect(child.find('service_list')).toBeDefined()
  })

  it('still loses agent, worktree and operator tools', () => {
    const child = asAChildSees()

    expect(child.find('agent_spawn')).toBeUndefined()
    expect(child.find('enter_worktree')).toBeUndefined()
    expect(child.find('operator_input')).toBeUndefined()
  })

  it('advertises every service tool rather than merely refusing by name', () => {
    const offered = asAChildSees()
      .declarations()
      .map((declaration) => declaration.name)

    expect(offered).toEqual(['service_start', 'service_stop', 'service_list', 'read', 'bash'])
  })
})
