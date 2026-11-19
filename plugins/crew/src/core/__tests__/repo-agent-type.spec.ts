import { describe, expect, it } from 'bun:test'

import { parseRepoAgentType, spawnPromptOf, SUB_AGENT_CONTRACT } from '..'

const claudeCodeFile = [
  '---',
  'name: security-reviewer',
  'description: Reviews the auth path for holes.',
  'tools: Read, Grep, Bash',
  'disallowed-tools: Write',
  'max-effect: read',
  'model: sonnet',
  '---',
  '',
  'You review authentication code and report what breaks.',
].join('\n')

describe('parseRepoAgentType', () => {
  it('loads a Claude Code agent file as a prompt only, ignoring its tools and model', () => {
    const parsed = parseRepoAgentType({
      text: claudeCodeFile,
      fallbackName: 'ignored',
      definedIn: '.agents/agents/security-reviewer.md',
    })
    expect(parsed).toEqual({
      ok: true,
      type: {
        name: 'security-reviewer',
        whenToUse: 'Reviews the auth path for holes.',
        prompt: 'You review authentication code and report what breaks.',
        definedIn: '.agents/agents/security-reviewer.md',
      },
    })
  })

  it('takes the filename when the frontmatter names nothing, lowercased and trimmed', () => {
    const parsed = parseRepoAgentType({
      text: '---\ndescription: does the thing\n---\n\nDo the thing.',
      fallbackName: '  Data-Migrator  ',
      definedIn: '.agents/agents/Data-Migrator.md',
    })
    expect(parsed.ok).toBe(true)
    expect(parsed.ok && parsed.type.name).toBe('data-migrator')
  })

  it('refuses a file with no description', () => {
    const parsed = parseRepoAgentType({
      text: '---\nname: auditor\n---\n\nAudit it.',
      fallbackName: 'auditor',
      definedIn: '.agents/agents/auditor.md',
    })
    expect(parsed).toEqual({
      ok: false,
      refusal: {
        name: 'auditor',
        definedIn: '.agents/agents/auditor.md',
        reason: 'has no description',
      },
    })
  })

  it('refuses a file with an empty body', () => {
    const parsed = parseRepoAgentType({
      text: '---\nname: auditor\ndescription: audits\n---\n\n  ',
      fallbackName: 'auditor',
      definedIn: '.agents/agents/auditor.md',
    })
    expect(parsed.ok).toBe(false)
    expect(parsed.ok === false && parsed.refusal.reason).toBe('has no prompt')
  })

  it('refuses a name that is not lowercase letters, digits and dashes', () => {
    const parsed = parseRepoAgentType({
      text: '---\nname: Security_Reviewer\ndescription: audits\n---\n\nAudit it.',
      fallbackName: 'auditor',
      definedIn: '.agents/agents/auditor.md',
    })
    expect(parsed.ok).toBe(false)
    expect(parsed.ok === false && parsed.refusal.name).toBe('security_reviewer')
    expect(parsed.ok === false && parsed.refusal.reason).toContain('usable name')
  })

  it('refuses a name a built-in type already has', () => {
    const parsed = parseRepoAgentType({
      text: '---\ndescription: builds things\n---\n\nBuild it.',
      fallbackName: 'builder',
      definedIn: '.agents/agents/builder.md',
    })
    expect(parsed).toEqual({
      ok: false,
      refusal: {
        name: 'builder',
        definedIn: '.agents/agents/builder.md',
        reason: 'is a built-in agent type',
      },
    })
  })

  it('refuses the teammate name, which is reserved', () => {
    const parsed = parseRepoAgentType({
      text: '---\ndescription: talks to the human\n---\n\nTalk to them.',
      fallbackName: 'teammate',
      definedIn: '.agents/agents/teammate.md',
    })
    expect(parsed.ok).toBe(false)
    expect(parsed.ok === false && parsed.refusal.reason).toBe(
      'is reserved for the built-in teammate agent type',
    )
  })
})

describe('spawnPromptOf', () => {
  it('puts the contract before the brief for a built-in type', () => {
    expect(spawnPromptOf({ contract: SUB_AGENT_CONTRACT, brief: 'Find it.' })).toBe(
      `${SUB_AGENT_CONTRACT}\n\nFind it.`,
    )
  })

  it('puts the contract, then the repo type prompt, then the brief', () => {
    expect(
      spawnPromptOf({ contract: SUB_AGENT_CONTRACT, prompt: 'Review it.', brief: 'Find it.' }),
    ).toBe(`${SUB_AGENT_CONTRACT}\n\nReview it.\n\nFind it.`)
  })
})
