import { EDefinitionOrigin } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { AGENT_SPAWN_TOOL_NAME, type AgentType } from '../agent-type'
import { EmbeddedAgentTypeSource } from '../embedded-source'
import { loadAgentTypes } from '../registry'

const load = async (): Promise<readonly AgentType[]> =>
  (await loadAgentTypes({ sources: [new EmbeddedAgentTypeSource()] })).types

const named = async (name: string): Promise<AgentType> => {
  const found = (await load()).find((agentType) => agentType.name === name)
  if (found === undefined) throw new Error(`no built-in agent type named ${name}`)
  return found
}

const CAPABILITY_CLAIMS = [
  'read-only',
  'no shell',
  'cannot change',
  'changes nothing',
  'withheld',
  'you have no tool',
  'full tool set',
]

describe('the built-in agent types', () => {
  it('ships general-purpose, explore, builder, reviewer and preview, all marked built-in', async () => {
    const loaded = await load()

    expect(loaded.map((agentType) => agentType.name)).toEqual([
      'builder',
      'explore',
      'general-purpose',
      'preview',
      'reviewer',
      'teammate',
    ])
    for (const agentType of loaded) {
      expect(agentType.origin).toBe(EDefinitionOrigin.BuiltIn)
    }
  })

  it('pins no model, so a child inherits the parent until model reachability is multi-vendor', async () => {
    for (const agentType of await load()) {
      expect(agentType.model).toBeUndefined()
    }
  })

  it('gives every built-in a whenToUse the model can choose on, and a prompt', async () => {
    for (const agentType of await load()) {
      expect(agentType.whenToUse.length).toBeGreaterThan(40)
      expect(agentType.prompt.length).toBeGreaterThan(40)
    }
  })

  it('denies agent_spawn to every built-in sub-agent, so a child cannot spawn its own children', async () => {
    for (const agentType of await load()) {
      if (agentType.name === 'teammate') continue
      expect(agentType.disallowedTools).toContain(AGENT_SPAWN_TOOL_NAME)
      expect(agentType.tools ?? []).not.toContain(AGENT_SPAWN_TOOL_NAME)
    }
  })

  it('denies nothing to the teammate: it runs sub-agents of its own, and the spawn listing it is shown never mentions teammates', async () => {
    const teammate = await named('teammate')

    expect(teammate.disallowedTools).toBeUndefined()
    expect(teammate.tools).toBeUndefined()
  })

  it('narrows no built-in, so every one has the capabilities of the agent that spawned it', async () => {
    for (const agentType of await load()) {
      expect(agentType.tools).toBeUndefined()
      expect(agentType.maxEffect).toBeUndefined()
    }
  })

  it('denies nothing but the spawn tool to the sub-agents', async () => {
    for (const agentType of await load()) {
      if (agentType.name === 'teammate') continue
      expect(agentType.disallowedTools).toEqual([AGENT_SPAWN_TOOL_NAME])
    }
  })

  it('tells every sub-agent that only its final message reaches the caller, and to stay within the task', async () => {
    for (const agentType of await load()) {
      if (agentType.name === 'teammate') continue
      expect(agentType.prompt).toContain('Only your final message reaches the caller')
      expect(agentType.prompt).toContain('nothing beyond it')
    }
  })

  it('tells the teammate to report deliberately, and which endings say nothing', async () => {
    const teammate = await named('teammate')

    expect(teammate.prompt).toContain('report_to_main')
    expect(teammate.prompt).toContain('that pause is bookkeeping')
    expect(teammate.prompt).toContain('cannot ask the developer')
  })

  it('tells the teammate that going quiet between reports is how it is meant to run', async () => {
    const teammate = await named('teammate')

    expect(teammate.prompt).toContain('relays your ending to the main agent')
    expect(teammate.prompt).toContain('going quiet between reports')
  })

  it('gives the preview agent the playbook that makes a preview actually load', async () => {
    const preview = await named('preview')

    expect(preview.prompt).toContain('0.0.0.0')
    expect(preview.prompt).toContain('exposePort')
    expect(preview.prompt).toContain('CORS')
    expect(preview.prompt).toContain('allowedDevOrigins')
    expect(preview.prompt).toContain('service_start')
    expect(preview.prompt).toContain('.atlas/preview.md')
    expect(preview.prompt).toContain('Verify before you report')
  })

  it('directs the teammate to manage its workstream in its own repository worktree', async () => {
    const teammate = await named('teammate')

    expect(teammate.prompt).toContain('Manage your workstream in your own repository worktree.')
    expect(teammate.prompt).toContain("Create it with git worktree add according to the project's worktree configuration and instructions")
    expect(teammate.prompt).toContain('enter it by path with enter_worktree before making implementation changes')
    expect(teammate.whenToUse).toContain('its own repository worktree')
  })

  it('describes the teammate toolbox without promising operator-facing controls', async () => {
    const teammate = await named('teammate')

    expect(teammate.prompt).toContain('normal session workspace and execution tools')
    expect(teammate.prompt).not.toContain('whole toolbox')
  })

  it('never tells the teammate that spawning teammates is a thing', async () => {
    const teammate = await named('teammate')

    expect(teammate.prompt).not.toMatch(/spawn.*teammate/i)
  })

  it('claims no capability limit the mechanism does not enforce, in prompt or in whenToUse', async () => {
    for (const agentType of await load()) {
      const prose = `${agentType.prompt} ${agentType.whenToUse}`.toLowerCase()
      for (const claim of CAPABILITY_CLAIMS) expect(prose).not.toContain(claim)
    }
  })

  it('tells explore and reviewer to report rather than change, as an instruction not a limit', async () => {
    for (const name of ['explore', 'reviewer']) {
      const agentType = await named(name)
      expect(agentType.prompt).toContain('only to observe')
      expect(agentType.whenToUse).toContain('briefed to report')
    }
  })
})
