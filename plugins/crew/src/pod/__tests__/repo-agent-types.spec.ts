import { describe, expect, it } from 'bun:test'

import { dirs, file, rig, turn } from './repo-agent-rig'
import { discoverRepoAgentTypes } from '../repo-agent-types'

const docsWriter = [
  '---',
  'description: Writes the docs a change needs.',
  'tools: Read, Write',
  '---',
  '',
  'Write the docs.',
].join('\n')

const secondDocsWriter = [
  '---',
  'name: docs-writer',
  'description: A second definition of the same type.',
  '---',
  '',
  'Write the docs twice.',
].join('\n')

const securityReviewer = [
  '---',
  'description: Reviews the auth path.',
  'model: sonnet',
  '---',
  '',
  'Review authentication code.',
].join('\n')

const nodes = {
  ...dirs(
    '/work/.agents/agents',
    '/work/.agents/agents/helpers',
    '/work/.atlas/agents',
    '/work/.claude/agents',
  ),
  ...Object.fromEntries([
    file('/work/.agents/agents/builder.md', securityReviewer),
    file('/work/.agents/agents/docs-writer.md', docsWriter),
    file('/work/.agents/agents/helpers/nested.md', docsWriter),
    file('/work/.agents/agents/notes.txt', 'not an agent'),
    file('/work/.agents/agents/second-docs.md', secondDocsWriter),
    file('/work/.atlas/agents/security-reviewer.md', securityReviewer),
    file('/work/.claude/agents/old.md', securityReviewer),
  ]),
}

describe('discoverRepoAgentTypes', () => {
  it('loads flat markdown from .agents/agents, the first definition of a name winning', async () => {
    const { ctx } = rig({ nodes })
    const found = await discoverRepoAgentTypes({ ctx, projectDirectory: '/work' })

    expect(found.types.map((type) => type.name)).toEqual(['docs-writer'])
    expect(found.types[0]?.definedIn).toBe('.agents/agents/docs-writer.md')
    expect(found.types[0]?.prompt).toBe('Write the docs.')
    expect(found.refusals).toEqual([
      {
        name: 'builder',
        definedIn: '.agents/agents/builder.md',
        reason: 'is a built-in agent type',
      },
      {
        name: 'docs-writer',
        definedIn: '.agents/agents/second-docs.md',
        reason: 'is shadowed by .agents/agents/docs-writer.md',
      },
    ])
  })

  it('ignores subdirectories and files that are not markdown', async () => {
    const { ctx } = rig({ nodes })
    const found = await discoverRepoAgentTypes({ ctx, projectDirectory: '/work' })
    const paths = [...found.types, ...found.refusals].map((each) => each.definedIn)
    expect(paths).not.toContain('.agents/agents/helpers/nested.md')
    expect(paths).not.toContain('.agents/agents/notes.txt')
  })

  it('does not read .atlas/agents or .claude/agents, which are not v2 roots', async () => {
    const { ctx, calls } = rig({ nodes })
    const found = await discoverRepoAgentTypes({ ctx, projectDirectory: '/work' })

    expect(found.types.map((type) => type.name)).not.toContain('security-reviewer')
    expect(calls.some((call) => 'path' in call && call.path.includes('/.atlas/'))).toBe(false)
    expect(calls.some((call) => 'path' in call && call.path.includes('/.claude/'))).toBe(false)
  })

  it('treats a missing root as empty', async () => {
    const { ctx } = rig({ nodes: dirs('/work/.claude/agents') })
    const found = await discoverRepoAgentTypes({ ctx, projectDirectory: '/work' })
    expect(found).toEqual({ types: [], refusals: [] })
  })
})

describe('the repo agent type listing', () => {
  it('lists the types and says why a file was not loaded', async () => {
    const { ctx } = rig({ nodes })
    const blocks = await turn({ ctx })
    expect(blocks.at(-1)).toBe(
      [
        'Agent types defined in this repository. Spawn one with agent_spawn, like the built-in types:',
        '- docs-writer: Writes the docs a change needs.',
        'Not loaded: .agents/agents/builder.md — "builder" is a built-in agent type',
        'Not loaded: .agents/agents/second-docs.md — "docs-writer" is shadowed by .agents/agents/docs-writer.md',
      ].join('\n'),
    )
  })

  it('adds nothing when the repository defines no agent type', async () => {
    const { ctx } = rig({ nodes: dirs('/work/.claude/agents') })
    const blocks = await turn({ ctx })
    expect(blocks).toEqual(['You are the main agent.'])
  })
})
