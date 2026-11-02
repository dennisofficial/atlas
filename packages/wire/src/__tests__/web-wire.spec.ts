import { describe, expect, it } from 'bun:test'

import {
  ENV_NAME_PATTERN,
  EShipBehavior,
  mcpUpsertSchema,
  projectSandboxSchema,
  projectSchema,
} from '../web'

describe('web wire schemas', () => {
  it('env names follow shell identifier rules', () => {
    expect(ENV_NAME_PATTERN.test('OPENAI_API_KEY')).toBe(true)
    expect(ENV_NAME_PATTERN.test('_x1')).toBe(true)
    expect(ENV_NAME_PATTERN.test('1BAD')).toBe(false)
    expect(ENV_NAME_PATTERN.test('has-dash')).toBe(false)
    expect(ENV_NAME_PATTERN.test('A'.repeat(201))).toBe(false)
  })

  it('project sandbox accepts null or a Vercel pod size of 1 or an even 2..32 vcpus', () => {
    expect(projectSandboxSchema.safeParse({ vcpus: null, setupScript: '' }).success).toBe(true)
    for (const vcpus of [1, 2, 16, 32]) {
      expect(projectSandboxSchema.safeParse({ vcpus, setupScript: '' }).success).toBe(true)
    }
    for (const vcpus of [0, 3, 33, 34, 2.5]) {
      expect(projectSandboxSchema.safeParse({ vcpus, setupScript: '' }).success).toBe(false)
    }
    expect(
      projectSandboxSchema.safeParse({ vcpus: 2, setupScript: 'x'.repeat(20001) }).success,
    ).toBe(false)
  })

  it('project defaults description and shipBehavior so an old payload still parses', () => {
    const parsed = projectSchema.parse({
      id: 'p',
      name: 'n',
      repo: null,
      baseBranch: null,
      additionalRepos: [],
      createdAt: 'a',
      updatedAt: 'b',
    })
    expect(parsed.description).toBe('')
    expect(parsed.shipBehavior).toBe(EShipBehavior.OpenPullRequest)
  })

  it('mcp upsert validates the transport union', () => {
    expect(
      mcpUpsertSchema.safeParse({ transport: { kind: 'stdio', command: 'npx' } }).success,
    ).toBe(true)
    expect(
      mcpUpsertSchema.safeParse({ transport: { kind: 'http', url: 'https://x.dev' } }).success,
    ).toBe(true)
    expect(mcpUpsertSchema.safeParse({ transport: { kind: 'stdio' } }).success).toBe(false)
    expect(mcpUpsertSchema.safeParse({ disabled: true }).success).toBe(true)
  })
})
