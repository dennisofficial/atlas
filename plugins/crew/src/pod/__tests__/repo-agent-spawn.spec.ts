import { describe, expect, it } from 'bun:test'

import { SUB_AGENT_CONTRACT, crewAgentTypeOf } from '../../core'
import { spawnPromptOf } from '../../core'
import { dirs, fakeCrew, file, invoke, rig, spawnedPrompt, textOf } from './repo-agent-rig'

const securityReviewer = [
  '---',
  'description: Reviews the auth path.',
  'tools: Read, Grep, Bash',
  'model: sonnet',
  '---',
  '',
  'Review authentication code and report what breaks.',
].join('\n')

const nodes = {
  ...dirs('/work/.agents/agents'),
  ...Object.fromEntries([file('/work/.agents/agents/security-reviewer.md', securityReviewer)]),
}

describe('agent_spawn with a repo agent type', () => {
  it('spawns with the sub-agent contract, the repo prompt and the brief', async () => {
    const crew = fakeCrew()
    const { ctx } = rig({ nodes, crew: crew.port })
    const outcome = await invoke({
      ctx,
      name: 'agent_spawn',
      input: {
        agentType: 'security-reviewer',
        intent: 'review the auth path',
        brief: 'Read src/auth and report what breaks.',
      },
    })

    expect(outcome.ok).toBe(true)
    expect(spawnedPrompt(crew.calls)).toBe(
      spawnPromptOf({
        contract: SUB_AGENT_CONTRACT,
        prompt: 'Review authentication code and report what breaks.',
        brief: 'Read src/auth and report what breaks.',
      }),
    )
    expect(outcome.ok && outcome.output).toEqual({
      agentId: 'a1',
      agentType: 'security-reviewer',
      intent: 'review the auth path',
    })
  })

  it('still prefers a built-in type over a repo file of the same name', async () => {
    const crew = fakeCrew()
    const { ctx } = rig({
      nodes: {
        ...dirs('/work/.agents/agents'),
        ...Object.fromEntries([file('/work/.agents/agents/builder.md', securityReviewer)]),
      },
      crew: crew.port,
    })
    const outcome = await invoke({
      ctx,
      name: 'agent_spawn',
      input: { agentType: 'builder', intent: 'edit', brief: 'Change the file.' },
    })
    expect(outcome.ok).toBe(true)
    expect(spawnedPrompt(crew.calls)).toBe(
      `${crewAgentTypeOf('builder')?.contract}\n\nChange the file.`,
    )
  })

  it('refuses an unknown type and names the repo types it did find', async () => {
    const crew = fakeCrew()
    const { ctx } = rig({ nodes, crew: crew.port })
    const outcome = await invoke({
      ctx,
      name: 'agent_spawn',
      input: { agentType: 'teammate', intent: 'peer', brief: 'Do the work.' },
    })
    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toBe(
      'there is no agent type "teammate"; known types are general-purpose, explore, builder, reviewer, or a type defined in this repository: security-reviewer',
    )
    expect(crew.calls).toEqual([])
  })

  it('names only the built-in types when the repository defines none', async () => {
    const { ctx } = rig({ nodes: dirs('/work/.agents/agents') })
    const outcome = await invoke({
      ctx,
      name: 'agent_spawn',
      input: { agentType: 'security-reviewer', intent: 'review', brief: 'Review it.' },
    })
    expect(textOf(outcome)).toBe(
      'there is no agent type "security-reviewer"; known types are general-purpose, explore, builder, reviewer',
    )
  })
})
