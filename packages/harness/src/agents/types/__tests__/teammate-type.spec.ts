import { describe, expect, it } from 'bun:test'

import { EDefinitionOrigin } from '@dltech/atlas-core'

import {
  AGENT_SPAWN_TOOL_NAME,
  EAgentTypeRefusal,
  parseAgentType,
  TEAMMATE_AGENT_TYPE,
} from '../agent-type'
import { EmbeddedAgentTypeSource } from '../embedded-source'
import { loadAgentTypes } from '../registry'
import { DirectoryAgentTypeSource } from '../directory-source'

const TEAMMATE_MARKDOWN = [
  '---',
  'name: teammate',
  'description: a home-grown teammate',
  '---',
  'You are a teammate, allegedly.',
].join('\n')

describe('the teammate type', () => {
  it('ships as a built-in, keeping agent_spawn so it can run sub-agents of its own', async () => {
    const { types } = await loadAgentTypes({ sources: [new EmbeddedAgentTypeSource()] })

    const teammate = types.find((agentType) => agentType.name === TEAMMATE_AGENT_TYPE)
    expect(teammate).toBeDefined()
    expect(teammate?.origin).toBe(EDefinitionOrigin.BuiltIn)
    expect(teammate?.disallowedTools ?? []).not.toContain(AGENT_SPAWN_TOOL_NAME)
  })

  it('is a reserved name: no user or project definition may wear it', () => {
    for (const origin of [EDefinitionOrigin.User, EDefinitionOrigin.Project]) {
      const parsed = parseAgentType({
        text: TEAMMATE_MARKDOWN,
        fallbackName: 'teammate',
        origin,
      })

      expect(parsed.ok).toBe(false)
      expect(parsed.ok ? '' : parsed.refusal).toBe(EAgentTypeRefusal.ReservedName)
    }
  })

  it('accepts the name from the built-in source itself', () => {
    const parsed = parseAgentType({
      text: TEAMMATE_MARKDOWN,
      fallbackName: 'teammate',
      origin: EDefinitionOrigin.BuiltIn,
    })

    expect(parsed.ok).toBe(true)
  })

  it('surfaces the refusal rather than shadowing, when a directory defines it', async () => {
    const directory = new DirectoryAgentTypeSource({
      origin: EDefinitionOrigin.Project,
      directory: '/agents',
      read: () =>
        Promise.resolve({
          files: [{ name: 'teammate.md', path: '/agents/teammate.md', text: TEAMMATE_MARKDOWN }],
          unreadable: [],
        }),
    })

    const catalog = await loadAgentTypes({
      sources: [new EmbeddedAgentTypeSource(), directory],
    })

    expect(catalog.refusals.map((refusal) => refusal.refusal)).toContain(
      EAgentTypeRefusal.ReservedName,
    )
    expect(
      catalog.types.filter((agentType) => agentType.name === TEAMMATE_AGENT_TYPE),
    ).toHaveLength(1)
  })
})
