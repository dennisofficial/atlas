import { EDefinitionOrigin } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { AGENT_SPAWN_TOOL_NAME, AgentTypeSource, type AgentTypeRead } from '../agent-type'
import { DirectoryAgentTypeSource } from '../directory-source'
import { loadAgentTypes } from '../registry'

class FakeAgentTypeSource extends AgentTypeSource {
  readonly origin: EDefinitionOrigin
  private readonly files: readonly { name: string; text: string }[]

  constructor(args: {
    origin: EDefinitionOrigin
    files: readonly { name: string; text: string }[]
  }) {
    super()
    this.origin = args.origin
    this.files = args.files
  }

  load(): Promise<AgentTypeRead> {
    return new DirectoryAgentTypeSource({
      directory: this.origin,
      origin: this.origin,
      read: async () => ({
        files: this.files.map((file) => ({ ...file, path: `${this.origin}/${file.name}` })),
        unreadable: [],
      }),
    }).load()
  }
}

const sourceOf = (args: {
  origin: EDefinitionOrigin
  files: readonly { name: string; text: string }[]
}): AgentTypeSource => new FakeAgentTypeSource(args)

const definition = (args: { description?: string; body?: string }): string =>
  ['---', `description: ${args.description ?? 'do things'}`, '---', args.body ?? 'Prompt.'].join(
    '\n',
  )

describe('loadAgentTypes', () => {
  it('merges every source when no name collides', async () => {
    const { types: loaded } = await loadAgentTypes({
      sources: [
        sourceOf({
          origin: EDefinitionOrigin.BuiltIn,
          files: [{ name: 'builder.md', text: definition({}) }],
        }),
        sourceOf({
          origin: EDefinitionOrigin.User,
          files: [{ name: 'auditor.md', text: definition({}) }],
        }),
        sourceOf({
          origin: EDefinitionOrigin.Project,
          files: [{ name: 'migrator.md', text: definition({}) }],
        }),
      ],
    })

    expect(loaded.map((agentType) => agentType.name)).toEqual(['auditor', 'builder', 'migrator'])
  })

  it('lets a project file shadow a user file shadow a built-in', async () => {
    const file = (body: string) => [{ name: 'reviewer.md', text: definition({ body }) }]

    const { types: loaded } = await loadAgentTypes({
      sources: [
        sourceOf({ origin: EDefinitionOrigin.Project, files: file('project prompt') }),
        sourceOf({ origin: EDefinitionOrigin.BuiltIn, files: file('built-in prompt') }),
        sourceOf({ origin: EDefinitionOrigin.User, files: file('user prompt') }),
      ],
    })

    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.origin).toBe(EDefinitionOrigin.Project)
    expect(loaded[0]?.prompt).toBe('project prompt')
  })

  it('lets a user file shadow a built-in when no project file claims the name', async () => {
    const file = (body: string) => [{ name: 'reviewer.md', text: definition({ body }) }]

    const { types: loaded } = await loadAgentTypes({
      sources: [
        sourceOf({ origin: EDefinitionOrigin.BuiltIn, files: file('built-in prompt') }),
        sourceOf({ origin: EDefinitionOrigin.User, files: file('user prompt') }),
      ],
    })

    expect(loaded[0]?.origin).toBe(EDefinitionOrigin.User)
    expect(loaded[0]?.prompt).toBe('user prompt')
  })

  it('ignores the tool lines a definition carries, since a type never narrows a tool set', async () => {
    const text = [
      '---',
      'description: do things',
      `tools: read, ${AGENT_SPAWN_TOOL_NAME}`,
      'disallowed-tools: write',
      'max-effect: read',
      '---',
      'Prompt.',
    ].join('\n')

    const { types: loaded } = await loadAgentTypes({
      sources: [sourceOf({ origin: EDefinitionOrigin.User, files: [{ name: 'narrow.md', text }] })],
    })

    expect(loaded[0]?.prompt).toBe('Prompt.')
    expect(Object.keys(loaded[0] ?? {})).not.toContain('tools')
    expect(Object.keys(loaded[0] ?? {})).not.toContain('disallowedTools')
    expect(Object.keys(loaded[0] ?? {})).not.toContain('maxEffect')
  })

  it('records which definition a winner displaced, so a shadow is visible rather than a mystery', async () => {
    const file = (body: string) => [{ name: 'reviewer.md', text: definition({ body }) }]

    const { types, shadowed } = await loadAgentTypes({
      sources: [
        sourceOf({ origin: EDefinitionOrigin.BuiltIn, files: file('built-in prompt') }),
        sourceOf({ origin: EDefinitionOrigin.User, files: file('user prompt') }),
        sourceOf({ origin: EDefinitionOrigin.Project, files: file('project prompt') }),
      ],
    })

    expect(types).toHaveLength(1)
    expect(shadowed).toEqual([
      {
        name: 'reviewer',
        origin: EDefinitionOrigin.BuiltIn,
        definedIn: 'built-in/reviewer.md',
        shadowedBy: EDefinitionOrigin.Project,
      },
      {
        name: 'reviewer',
        origin: EDefinitionOrigin.User,
        definedIn: 'user/reviewer.md',
        shadowedBy: EDefinitionOrigin.Project,
      },
    ])
  })

  it('shadows nothing when every name is claimed once', async () => {
    const { shadowed } = await loadAgentTypes({
      sources: [
        sourceOf({
          origin: EDefinitionOrigin.User,
          files: [{ name: 'auditor.md', text: definition({}) }],
        }),
      ],
    })

    expect(shadowed).toEqual([])
  })

  it('yields nothing when no source has anything to offer', async () => {
    expect(await loadAgentTypes({ sources: [] })).toEqual({
      types: [],
      refusals: [],
      shadowed: [],
    })
  })
})
