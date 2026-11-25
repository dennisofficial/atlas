import { describe, expect, it } from 'bun:test'

import {
  ENV_NAME_PATTERN,
  EShipBehavior,
  mcpServerSchema,
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
    expect(
      projectSandboxSchema.safeParse({ vcpus: null, diskGb: null, setupScript: '' }).success,
    ).toBe(true)
    for (const vcpus of [1, 2, 16, 32]) {
      expect(projectSandboxSchema.safeParse({ vcpus, diskGb: null, setupScript: '' }).success).toBe(
        true,
      )
    }
    for (const vcpus of [0, 3, 33, 34, 2.5]) {
      expect(projectSandboxSchema.safeParse({ vcpus, diskGb: null, setupScript: '' }).success).toBe(
        false,
      )
    }
    expect(
      projectSandboxSchema.safeParse({
        vcpus: 2,
        diskGb: null,
        setupScript: 'x'.repeat(20001),
      }).success,
    ).toBe(false)
  })

  it('project sandbox accepts null or one of the Agent37 disk sizes', () => {
    for (const diskGb of [20, 30, 40, 60, 80, 100]) {
      expect(projectSandboxSchema.safeParse({ vcpus: null, diskGb, setupScript: '' }).success).toBe(
        true,
      )
    }
    for (const diskGb of [0, 10, 25, 50, 120, 20.5]) {
      expect(projectSandboxSchema.safeParse({ vcpus: null, diskGb, setupScript: '' }).success).toBe(
        false,
      )
    }
  })

  it('project sandbox accepts null or 1 to 64 GB of memory, defaulting an old payload to null', () => {
    expect(
      projectSandboxSchema.parse({ vcpus: null, diskGb: null, setupScript: '' }).memoryGb,
    ).toBeNull()
    for (const memoryGb of [null, 1, 4, 16, 64]) {
      expect(
        projectSandboxSchema.safeParse({ vcpus: 4, memoryGb, diskGb: null, setupScript: '' })
          .success,
      ).toBe(true)
    }
    for (const memoryGb of [0, 65, 16.5]) {
      expect(
        projectSandboxSchema.safeParse({ vcpus: 4, memoryGb, diskGb: null, setupScript: '' })
          .success,
      ).toBe(false)
    }
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

  it('mcp upsert carries the proxy switch and rejects an unknown key beside it', () => {
    const parsed = mcpUpsertSchema.safeParse({
      disabled: true,
      proxy: true,
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success ? parsed.data.proxy : undefined).toBe(true)
    expect(mcpUpsertSchema.safeParse({ disabled: true, proxied: true }).success).toBe(false)
  })

  it('mcp list row keeps the proxy switch', () => {
    const parsed = mcpServerSchema.parse({
      name: 'paper',
      transport: { kind: 'stdio', command: 'paper' },
      proxy: true,
      updatedAt: '2026-11-19T00:00:00.000Z',
    })
    expect(parsed.proxy).toBe(true)
  })
})
