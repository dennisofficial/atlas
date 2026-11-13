import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { resolveCloudSetting } from '../web/settings-registry'

describe('resolveCloudSetting', () => {
  it('reads a stored value', () => {
    const values = new Map<string, string | number | boolean>([['model.effort', 'high']])

    expect(resolveCloudSetting({ values, key: 'model.effort', schema: z.string() })).toBe('high')
  })

  it('falls back to the registry entry when nothing is stored', () => {
    expect(
      resolveCloudSetting({ values: new Map(), key: 'model.effort', schema: z.string() }),
    ).toBe('medium')
  })

  it('falls back when the stored value does not fit the schema', () => {
    const values = new Map<string, string | number | boolean>([['model.fast', 'yes']])

    expect(resolveCloudSetting({ values, key: 'model.fast', schema: z.boolean() })).toBe(false)
  })

  it('falls back when the stored value fits neither schema', () => {
    const values = new Map<string, string | number | boolean>([['model.effort', 'extreme']])

    expect(
      resolveCloudSetting({
        values,
        key: 'model.effort',
        schema: z.enum(['low', 'medium', 'high']),
      }),
    ).toBe('medium')
  })

  it('resolves a per-agent-type key through its prefix entry', () => {
    const values = new Map<string, string | number | boolean>([
      ['agents.type.builder', 'anthropic/claude-sonnet-5'],
    ])

    expect(resolveCloudSetting({ values, key: 'agents.type.builder', schema: z.string() })).toBe(
      'anthropic/claude-sonnet-5',
    )
    expect(resolveCloudSetting({ values, key: 'agents.type.teammate', schema: z.string() })).toBe(
      '',
    )
    expect(
      resolveCloudSetting({ values, key: 'agents.type.builder.effort', schema: z.string() }),
    ).toBe('')
    expect(
      resolveCloudSetting({ values, key: 'agents.type.builder.fast', schema: z.boolean() }),
    ).toBe(false)
  })

  it('refuses a key the registry does not know', () => {
    expect(() =>
      resolveCloudSetting({ values: new Map(), key: 'nobody.knows', schema: z.string() }),
    ).toThrow('nobody.knows')
  })
})
