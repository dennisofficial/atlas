import { describe, expect, it } from 'bun:test'

import { eventTypesOf } from '@dltech/atlas-plugin-sdk'

import { composedPlugins, registeredPlugins } from '../registered-plugins'
import { podContextOf } from '../testing/pod-context'

describe('the agent host plugin composition', () => {
  it('registers crew beside the other native plugins', () => {
    expect(composedPlugins.names).toContain('crew')
  })

  it('keeps memory and spawn tools away from a sub-agent', () => {
    expect(composedPlugins.pod.childDeny).toContain('write_memory')
    expect(composedPlugins.pod.childDeny).toContain('read_memory')
    expect(composedPlugins.pod.childDeny).toContain('agent_spawn')
    expect(composedPlugins.pod.childDeny).not.toContain('report_to_main')
  })

  it('registers the peer sessions plugin with its fragment', () => {
    expect(composedPlugins.names).toContain('sessions')
    expect(composedPlugins.pod.prompts.map((fragment) => fragment.id)).toContain('sessions.peers')
  })

  it('adds no event type', () => {
    const without = registeredPlugins.filter((plugin) => plugin.name !== 'sessions')
    expect(eventTypesOf(registeredPlugins)).toEqual(eventTypesOf(without))
  })

  it('keeps every pod tool off the mcp_ prefix Anthropic reserves for its own MCP tools', () => {
    const names = composedPlugins.pod.tools(podContextOf('s-1')).map((tool) => tool.name)
    const reserved = names.filter((name) => name.startsWith('mcp_') && !name.startsWith('mcp__'))

    expect(reserved).toEqual([])
  })

  it('registers the skills plugin with its four tools and both hooks', () => {
    const ctx = podContextOf('s-1')
    const names = composedPlugins.pod.tools(ctx).map((tool) => tool.name)
    const hooks = composedPlugins.pod.hooks(ctx)

    expect(names).toContain('skill')
    expect(names).toContain('skill_install')
    expect(names).toContain('skill_edit')
    expect(names).toContain('skill_delete')
    expect(hooks.beforeTurn?.map((hook) => hook.name)).toContain('skills-catalogue')
    expect(hooks.beforeStep?.map((hook) => hook.name)).toContain('skills-listing')
  })
})
