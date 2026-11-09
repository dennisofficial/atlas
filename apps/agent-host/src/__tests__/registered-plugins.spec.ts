import { describe, expect, it } from 'bun:test'

import { eventTypesOf } from '@dltech/atlas-plugin-sdk'

import { composedPlugins, registeredPlugins } from '../registered-plugins'

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

  it('registers the peer sessions plugin with its fragment and its command', () => {
    expect(composedPlugins.names).toContain('sessions')
    expect(composedPlugins.pod.prompts.map((fragment) => fragment.id)).toContain('sessions.peers')
    expect([...composedPlugins.control.commands.keys()]).toContain('reset-peer-budget')
  })

  it('adds no event type', () => {
    const without = registeredPlugins.filter((plugin) => plugin.name !== 'sessions')
    expect(eventTypesOf(registeredPlugins)).toEqual(eventTypesOf(without))
  })
})
