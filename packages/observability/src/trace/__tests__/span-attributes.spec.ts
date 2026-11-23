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

  it('flattens hashes into hash-prefixed attributes', () => {
    expect(
      spanAttributesOf({
        model: 'm',
        hashes: { tools: '0a1b2c3d', 'system.memory-index': 'ffee0011' },
      }),
    ).toEqual({ model: 'm', 'hash.tools': '0a1b2c3d', 'hash.system.memory-index': 'ffee0011' })
  })

  it('flattens timings into ms-suffixed attributes and keeps a boolean flag', () => {
    expect(
      spanAttributesOf({
        sessionId: 'ses-1',
        inboxId: 7,
        hasMedia: true,
        timings: { claim: 12, firstStep: 640 },
      }),
    ).toEqual({
      sessionId: 'ses-1',
      inboxId: 7,
      hasMedia: true,
      claimMs: 12,
      firstStepMs: 640,
    })
    expect('timings' in spanAttributesOf({ timings: { claim: 1 } })).toBe(false)
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
