import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { createV2EventSchema, v2EventSchema } from '../../record/event'
import { mint } from '../../record/__tests__/support'
import { createEventBodySchema } from '../create-schema'
import { eventBodySchema } from '../schema'

const probeSchema = z.object({ type: z.literal('probe-seen'), n: z.number() })

describe('createEventBodySchema', () => {
  it('is the core schema when no plugin bodies are given', () => {
    expect(createEventBodySchema()).toBe(eventBodySchema)
    expect(createEventBodySchema({ pluginBodies: [] })).toBe(eventBodySchema)
  })

  it('accepts a plugin body next to the core bodies', () => {
    const schema = createEventBodySchema({ pluginBodies: [probeSchema] })
    expect(schema.safeParse({ type: 'probe-seen', n: 1 }).success).toBe(true)
    expect(schema.safeParse({ type: 'user-said', text: 'hi' }).success).toBe(true)
    expect(schema.safeParse({ type: 'probe-seen', n: 'x' }).success).toBe(false)
    expect(schema.safeParse({ type: 'unknown-type' }).success).toBe(false)
  })
})

describe('createV2EventSchema', () => {
  it('matches v2EventSchema when no plugin bodies are given', () => {
    const [event] = mint({ count: 1 })
    const wire = JSON.parse(JSON.stringify(event))
    expect(createV2EventSchema().parse(wire)).toEqual(v2EventSchema.parse(wire))
    expect(createV2EventSchema().safeParse({ ...wire, type: 'probe-seen', n: 1 }).success).toBe(
      false,
    )
  })

  it('decodes a plugin body on a real envelope', () => {
    const [event] = mint({ count: 1 })
    const wire = { ...JSON.parse(JSON.stringify(event)), type: 'probe-seen', n: 1 }
    delete wire.text
    const parsed = createV2EventSchema({ pluginBodies: [probeSchema] }).safeParse(wire)
    expect(parsed.success).toBe(true)
    expect(v2EventSchema.safeParse(wire).success).toBe(false)
  })

  it('still refuses history-compacted even with plugin bodies', () => {
    const [event] = mint({ count: 1 })
    const wire = { ...JSON.parse(JSON.stringify(event)), type: 'history-compacted' }
    expect(createV2EventSchema({ pluginBodies: [probeSchema] }).safeParse(wire).success).toBe(false)
  })
})
