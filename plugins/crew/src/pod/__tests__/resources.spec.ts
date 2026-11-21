import { describe, expect, it } from 'bun:test'

import { repoAgentTypesResource, repoAgentTypesOf } from '../resource'
import { dirs, file, invoke, rig, textOf, turn } from './repo-agent-rig'

const securityReviewer = [
  '---',
  'description: Reviews the auth path.',
  '---',
  '',
  'Review authentication code.',
].join('\n')

const nodes = {
  ...dirs('/work/.agents/agents'),
  ...Object.fromEntries([
    file('/work/.agents/agents/security-reviewer.md', securityReviewer),
    file('/work/.agents/agents/builder.md', securityReviewer),
  ]),
}

describe('the crew agent type resource', () => {
  it('loads the repository agent types and the refusals they carry', async () => {
    const { ctx } = rig({ nodes })
    const found = await repoAgentTypesResource.load({ ctx, directory: '/work' })

    expect(found.types.map((type) => type.name)).toEqual(['security-reviewer'])
    expect(found.refusals).toEqual([
      {
        name: 'builder',
        definedIn: '.agents/agents/builder.md',
        reason: 'is a built-in agent type',
      },
    ])
  })

  it('lists the types from a recorded snapshot with zero daemon calls', async () => {
    const { ctx, calls } = rig({ nodes })
    await turn({ ctx })
    expect(repoAgentTypesOf(ctx)?.types).toHaveLength(1)
    calls.length = 0

    const blocks = await turn({ ctx, refresh: false })

    expect(blocks.join('\n')).toContain('- security-reviewer: Reviews the auth path.')
    expect(calls).toEqual([])
  })

  it('answers an unknown agent type from the snapshot with zero daemon calls', async () => {
    const { ctx, calls } = rig({ nodes })
    await turn({ ctx })
    calls.length = 0

    const outcome = await invoke({
      ctx,
      name: 'agent_spawn',
      input: { agentType: 'nope', intent: 'x', brief: 'y' },
    })

    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toContain('security-reviewer')
    expect(calls).toEqual([])
  })
})
