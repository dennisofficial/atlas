import { describe, expect, it } from 'bun:test'

import { InMemoryToolRegistry } from '@dltech/atlas-agent'
import { deferredDeclarationsOf } from '@dltech/atlas-core'
import { eventTypesOf } from '@dltech/atlas-plugin-sdk'

import { composedPluginsOf, registeredPlugins } from '../registered-plugins'
import { podContextOf } from '../testing/pod-context'

describe('the agent host plugin composition', () => {
  const composedPlugins = composedPluginsOf({ jinaApiKey: undefined })

  it('registers crew beside the other native plugins', () => {
    expect(composedPlugins.names).toContain('crew')
  })

  it('keeps memory and spawn tools away from a sub-agent', () => {
    expect(composedPlugins.pod.childDeny).toContain('memory')
    expect(composedPlugins.pod.childDeny).toContain('agent_spawn')
    expect(composedPlugins.pod.childDeny).not.toContain('send_message')
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

  it('defers the tools a turn rarely needs, and keeps the rest eager', () => {
    const tools = composedPlugins.pod.tools(podContextOf('s-1'))
    const declarations = new InMemoryToolRegistry(tools).declarations()
    const deferred = deferredDeclarationsOf(declarations)
      .map((declaration) => declaration.name)
      .sort()

    expect(deferred).toEqual([
      'agent_list',
      'archive_session',
      'list_sessions',
      'list_teammates',
      'operator_mcp_sign_in',
      'operator_shell_input',
      'routine',
      'skill_manage',
      'spawn_session',
      'spawn_teammate',
      'worktree_list',
    ])
  })

  it('registers the skills plugin with its two tools, its resource and its listing hook', () => {
    const ctx = podContextOf('s-1')
    const names = composedPlugins.pod.tools(ctx).map((tool) => tool.name)
    const hooks = composedPlugins.pod.hooks(ctx)

    expect(names).toContain('skill')
    expect(names).toContain('skill_manage')
    expect(composedPlugins.pod.resources.map((resource) => resource.name)).toContain('skills')
    expect(hooks.beforeTurn?.map((hook) => hook.name) ?? []).not.toContain('skills-catalogue')
    expect(hooks.beforeStep?.map((hook) => hook.name)).toContain('skills-listing')
  })
})
