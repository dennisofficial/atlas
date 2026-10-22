import { describe, expect, it } from 'bun:test'

import { TEAMMATE_AGENT_TYPE } from '../../../agents/types'
import { agentTypeNamed } from '../../../agents/registry/__tests__/fixtures'
import { AgentSpawnTool, withoutSpawnableListing } from '../agent-spawn'
import { InMemoryToolRegistry } from '../../registry'

const TYPES = [
  agentTypeNamed({ name: 'explore' }),
  agentTypeNamed({ name: 'builder' }),
  agentTypeNamed({ name: TEAMMATE_AGENT_TYPE }),
]

const noRegistry = (): never => {
  throw new Error('the listing never resolves the registry')
}

describe('the spawn listing a teammate is shown', () => {
  it('names every sub-agent type and never the word "teammate"', () => {
    const spawn = new AgentSpawnTool(noRegistry, TYPES)
    const redacted = spawn.withoutListedTypes([TEAMMATE_AGENT_TYPE])

    expect(spawn.description).toContain(TEAMMATE_AGENT_TYPE)
    expect(redacted.description).not.toContain(TEAMMATE_AGENT_TYPE)
    expect(redacted.description).toContain('explore')
    expect(redacted.description).toContain('builder')
  })

  it('does not claim sub-agents cannot spawn, once the teammate type is unlisted', () => {
    const spawn = new AgentSpawnTool(noRegistry, TYPES)
    const redacted = spawn.withoutListedTypes([TEAMMATE_AGENT_TYPE])

    expect(redacted.description).not.toMatch(/only the main session/i)
  })

  it('returns the tool itself when nothing it lists is hidden', () => {
    const spawn = new AgentSpawnTool(noRegistry, [agentTypeNamed({ name: 'explore' })])

    expect(spawn.withoutListedTypes([TEAMMATE_AGENT_TYPE])).toBe(spawn)
  })

  it('flows through the registry wrapper: declarations redacted, lookup intact', () => {
    const spawn = new AgentSpawnTool(noRegistry, TYPES)
    const registry = withoutSpawnableListing({
      registry: new InMemoryToolRegistry([spawn]),
      hidden: [TEAMMATE_AGENT_TYPE],
    })

    const declaration = registry.declarations().find((one) => one.name === 'agent_spawn')
    expect(declaration?.description).not.toContain(TEAMMATE_AGENT_TYPE)

    const found = registry.find('agent_spawn')
    expect(found?.description).not.toContain(TEAMMATE_AGENT_TYPE)
  })
})
