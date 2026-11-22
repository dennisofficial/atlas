import { describe, expect, it } from 'bun:test'
import { eventTypesOf } from '@dltech/atlas-plugin-sdk'
import { registeredPlugins as agentPlugins } from './agent/registered-plugins'
import { registeredPlugins as controlPlugins } from '@dltech/atlas-pods'

describe('plugin event parity', () => {
  it('lets the control plane read every event type the agent can append', () => {
    const readable = new Set(eventTypesOf(controlPlugins))
    expect(eventTypesOf(agentPlugins).filter((type) => !readable.has(type))).toEqual([])
  })
})
