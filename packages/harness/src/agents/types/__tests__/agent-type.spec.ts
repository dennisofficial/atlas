import { EDefinitionOrigin } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { EAgentTypeRefusal, parseAgentType, type AgentType } from '../agent-type'

const read = (text: string, fallbackName = 'reviewer') =>
  parseAgentType({ text, fallbackName, origin: EDefinitionOrigin.Project })

const parse = (text: string, fallbackName = 'reviewer'): AgentType | undefined => {
  const parsed = read(text, fallbackName)
  return parsed.ok ? parsed.agentType : undefined
}

const refusalOf = (text: string, fallbackName = 'reviewer'): EAgentTypeRefusal | undefined => {
  const parsed = read(text, fallbackName)
  return parsed.ok ? undefined : parsed.refusal
}

const detailOf = (text: string, fallbackName = 'reviewer'): string => {
  const parsed = read(text, fallbackName)
  return parsed.ok ? '' : parsed.detail
}

const frontmatter = (lines: readonly string[], body = 'Do the thing.'): string =>
  ['---', ...lines, '---', body].join('\n')

describe('parseAgentType', () => {
  it('maps description to whenToUse and the body to the prompt', () => {
    const parsed = parse(frontmatter(['description: Use me to review'], 'Review the diff.'))

    expect(parsed).toEqual({
      name: 'reviewer',
      whenToUse: 'Use me to review',
      prompt: 'Review the diff.',
      model: undefined,
      origin: EDefinitionOrigin.Project,
      definedIn: undefined,
    })
  })

  it('names the agent type after the file when frontmatter does not', () => {
    expect(parse(frontmatter(['description: d']), 'deep-review')?.name).toBe('deep-review')
  })

  it('lowercases a frontmatter name so the model passes one spelling', () => {
    expect(parse(frontmatter(['name: Deep-Review', 'description: d']))?.name).toBe('deep-review')
  })

  it('loads a Claude Code agent file unchanged, ignoring the tool lines it carries', () => {
    const parsed = parse(
      frontmatter(
        [
          'name: security-reviewer',
          'description: Reviews the diff for security bugs',
          'tools: Read, Grep, Glob, Bash',
          'disallowed-tools: Write',
          'max-effect: readonly',
        ],
        'Review the diff.',
      ),
    )

    expect(parsed).toEqual({
      name: 'security-reviewer',
      whenToUse: 'Reviews the diff for security bugs',
      prompt: 'Review the diff.',
      model: undefined,
      origin: EDefinitionOrigin.Project,
      definedIn: undefined,
    })
  })

  it('carries a pinned model through', () => {
    expect(parse(frontmatter(['description: d', 'model: haiku']))?.model).toBe('haiku')
  })

  it('skips a definition with no description, because that is how the model chooses one', () => {
    expect(parse(frontmatter(['name: reviewer']))).toBeUndefined()
    expect(parse(frontmatter(['description:    ']))).toBeUndefined()
  })

  it('skips a definition with no prompt body', () => {
    expect(parse(frontmatter(['description: d'], '   \n\n'))).toBeUndefined()
  })

  it('skips a definition with no frontmatter at all', () => {
    expect(parse('Just a prompt, no frontmatter.')).toBeUndefined()
  })

  it('skips an empty file', () => {
    expect(parse('   \n\n')).toBeUndefined()
  })

  it('skips a name the model could not pass verbatim', () => {
    expect(parse(frontmatter(['name: My Agent', 'description: d']))).toBeUndefined()
    expect(parse(frontmatter(['name: 1st', 'description: d']))).toBeUndefined()
    expect(parse(frontmatter(['description: d'], 'body'), 'notes copy')).toBeUndefined()
  })

  it('tolerates frontmatter keys it does not know', () => {
    expect(parse(frontmatter(['description: d', 'colour: green']))?.prompt).toBe('Do the thing.')
  })

  it('stamps the origin and the file it was loaded from', () => {
    const parsed = parseAgentType({
      text: frontmatter(['description: d']),
      fallbackName: 'reviewer',
      origin: EDefinitionOrigin.User,
      definedIn: '/h/.atlas/agents/reviewer.md',
    })

    expect(parsed.ok ? parsed.agentType.origin : undefined).toBe(EDefinitionOrigin.User)
    expect(parsed.ok ? parsed.agentType.definedIn : undefined).toBe('/h/.atlas/agents/reviewer.md')
  })
})

describe('what parseAgentType says when it refuses', () => {
  it('names the reason rather than handing back a bare nothing', () => {
    expect(refusalOf(frontmatter(['name: My Agent', 'description: d']))).toBe(
      EAgentTypeRefusal.BadName,
    )
    expect(refusalOf(frontmatter(['name: reviewer']))).toBe(EAgentTypeRefusal.NoDescription)
    expect(refusalOf(frontmatter(['description: d'], '  \n'))).toBe(EAgentTypeRefusal.NoPrompt)
    expect(refusalOf('   ')).toBe(EAgentTypeRefusal.Empty)
  })

  it('quotes the offending value, so the operator can find it in the file', () => {
    expect(detailOf(frontmatter(['name: My Agent', 'description: d']))).toContain('"my agent"')
  })

  it('carries the name it would have had, so a listing can point at the definition', () => {
    const parsed = read(frontmatter(['description: d'], '  '), 'deep-review')

    expect(parsed.ok ? '' : parsed.name).toBe('deep-review')
  })
})
