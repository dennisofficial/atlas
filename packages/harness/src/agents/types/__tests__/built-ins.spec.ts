import { EDefinitionOrigin } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import type { AgentType } from '../agent-type'
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
  it('ships general-purpose, explore, researcher, builder, reviewer and preview, all marked built-in', async () => {
    const loaded = await load()

    expect(loaded.map((agentType) => agentType.name)).toEqual([
      'builder',
      'explore',
      'general-purpose',
      'preview',
      'researcher',
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

  it('carries no tool narrowing: every built-in runs on the child runner’s structural denies', async () => {
    for (const agentType of await load()) {
      expect(Object.keys(agentType)).not.toContain('tools')
      expect(Object.keys(agentType)).not.toContain('disallowedTools')
      expect(Object.keys(agentType)).not.toContain('maxEffect')
    }
  })

  it('tells every sub-agent that only its final message reaches the caller, and to stay within the task', async () => {
    for (const agentType of await load()) {
      if (agentType.name === 'teammate') continue
      expect(agentType.prompt).toContain('Only your final message reaches the caller')
      expect(agentType.prompt).toContain('nothing beyond it')
    }
  })

  it('tells every sub-agent it may commit, push and open a PR from its own worktree', async () => {
    for (const agentType of await load()) {
      if (agentType.name === 'teammate') continue
      expect(agentType.prompt).toContain('open a pull request with `gh`')
      expect(agentType.prompt).toContain('you must report the URL')
    }
  })

  it('tells the teammate to report deliberately, and which endings say nothing', async () => {
    const teammate = await named('teammate')

    expect(teammate.prompt).toContain('report_to_main')
    expect(teammate.prompt).toContain('Ending your turn never tells it anything')
    expect(teammate.prompt).toContain('the operator reads')
  })

  it('tells the teammate that going quiet between reports is how it is meant to run', async () => {
    const teammate = await named('teammate')

    expect(teammate.prompt).toContain('Only a failure or a stop reaches the main agent by itself')
    expect(teammate.prompt).toContain('going quiet between reports')
  })

  it('gives the preview agent the playbook that makes a preview actually load', async () => {
    const preview = await named('preview')

    expect(preview.prompt).toContain('0.0.0.0')
    expect(preview.prompt).toContain('portal')
    expect(preview.prompt).toContain('CORS')
    expect(preview.prompt).toContain('allowedDevOrigins')
    expect(preview.prompt).toContain('.atlas/services.yaml')
    expect(preview.prompt).toContain('Never run project servers with `service_start`')
    expect(preview.prompt).toContain(
      'start via `service_start({ name })`, never as ad-hoc commands',
    )
    expect(preview.prompt).toContain('Declare dev mode only')
    expect(preview.prompt).toContain('honor `$PORT` with the old default')
    expect(preview.prompt).toContain('there is no `.atlas/preview.md`')
    expect(preview.prompt).toContain('Verify before you report')
  })

  it('sends the researcher to primary sources, with citations and versions', async () => {
    const researcher = await named('researcher')

    expect(researcher.prompt).toContain('primary sources')
    expect(researcher.prompt).toContain('Cite every claim with the URL')
    expect(researcher.prompt).toContain('Pin the version')
    expect(researcher.whenToUse).toContain('Use explore for how this codebase works')
  })

  it('directs the teammate to manage its workstream in its own repository worktree', async () => {
    const teammate = await named('teammate')

    expect(teammate.prompt).toContain('Manage your workstream in your own repository worktree.')
    expect(teammate.prompt).toContain(
      "Create it with git worktree add according to the project's worktree configuration and instructions",
    )
    expect(teammate.prompt).toContain(
      'enter it by path with enter_worktree before making implementation changes',
    )
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

  it('tells explore, researcher and reviewer to report rather than change, as an instruction not a limit', async () => {
    for (const name of ['explore', 'researcher', 'reviewer']) {
      const agentType = await named(name)
      expect(agentType.prompt).toContain('only to observe')
      expect(agentType.whenToUse).toContain('briefed to report')
    }
  })
})
