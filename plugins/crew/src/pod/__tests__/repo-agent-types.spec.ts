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

const securityReviewer = [
  '---',
  'description: Reviews the auth path.',
  'model: sonnet',
  '---',
  '',
  'Review authentication code.',
].join('\n')

const nodes = {
  ...dirs('/work/.atlas/agents', '/work/.atlas/agents/helpers', '/work/.claude/agents'),
  ...Object.fromEntries([
    file('/work/.atlas/agents/docs-writer.md', docsWriter),
    file('/work/.atlas/agents/helpers/nested.md', docsWriter),
    file('/work/.atlas/agents/notes.txt', 'not an agent'),
    file('/work/.claude/agents/docs-writer.md', docsWriter),
    file('/work/.claude/agents/security-reviewer.md', securityReviewer),
    file('/work/.claude/agents/builder.md', securityReviewer),
  ]),
}

describe('discoverRepoAgentTypes', () => {
  it('loads flat markdown from the repo roots, first root winning a duplicate name', async () => {
    const { ctx } = rig({ nodes })
    const found = await discoverRepoAgentTypes({ ctx, projectDirectory: '/work' })

    expect(found.types.map((type) => type.name)).toEqual(['docs-writer', 'security-reviewer'])
    expect(found.types[0]?.definedIn).toBe('.atlas/agents/docs-writer.md')
    expect(found.types[0]?.prompt).toBe('Write the docs.')
    expect(found.refusals).toEqual([
      {
        name: 'builder',
        definedIn: '.claude/agents/builder.md',
        reason: 'is a built-in agent type',
      },
      {
        name: 'docs-writer',
        definedIn: '.claude/agents/docs-writer.md',
        reason: 'is shadowed by .atlas/agents/docs-writer.md',
      },
    ])
  })

  it('ignores subdirectories and files that are not markdown', async () => {
    const { ctx } = rig({ nodes })
    const found = await discoverRepoAgentTypes({ ctx, projectDirectory: '/work' })
    const paths = [...found.types, ...found.refusals].map((each) => each.definedIn)
    expect(paths).not.toContain('.atlas/agents/helpers/nested.md')
    expect(paths).not.toContain('.atlas/agents/notes.txt')
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
        'Agent types defined in this repository (spawn them with agent_spawn like the built-in types):',
        '- docs-writer: Writes the docs a change needs.',
        '- security-reviewer: Reviews the auth path.',
        'Not loaded: .claude/agents/builder.md — "builder" is a built-in agent type',
        'Not loaded: .claude/agents/docs-writer.md — "docs-writer" is shadowed by .atlas/agents/docs-writer.md',
      ].join('\n'),
    )
  })

  it('adds nothing when the repository defines no agent type', async () => {
    const { ctx } = rig({ nodes: dirs('/work/.claude/agents') })
    const blocks = await turn({ ctx })
    expect(blocks).toEqual(['You are the main agent.'])
  })
})
