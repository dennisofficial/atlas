import { describe, expect, it } from 'bun:test'

import { spanAttributesOf } from '../trace.port'

describe('spanAttributesOf', () => {
  it('flattens sizes into size-prefixed attributes and drops the sizes key itself', () => {
    const attributes = spanAttributesOf({
      model: 'claude-opus-5',
      sizes: { total: 900, 'system.system-prompt': 400 },
    })

    expect(attributes).toEqual({
      model: 'claude-opus-5',
      'size.total': 900,
      'size.system.system-prompt': 400,
    })
    expect('sizes' in attributes).toBe(false)
  })

  it('drops a field that carries no value', () => {
    expect(spanAttributesOf({ provider: 'anthropic', model: undefined })).toEqual({
      provider: 'anthropic',
    })
  })

  it('emits no size attribute when a span carries no sizes', () => {
    expect(spanAttributesOf({ provider: 'anthropic', tool: 'read' })).toEqual({
      provider: 'anthropic',
      tool: 'read',
    })
  })

  it('returns nothing for a span with no fields', () => {
    expect(spanAttributesOf(undefined)).toEqual({})
  })
})
