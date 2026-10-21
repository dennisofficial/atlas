import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { EToolEffect, type ToolDeclaration } from '@dltech/atlas-core'

import { toToolSet } from '../tool-set'
import { providerSafeSchema, withoutVacuousPropertyNames } from '../vacuous-property-names'

const schemaSentFor = async (declaration: ToolDeclaration): Promise<unknown> => {
  const sent = toToolSet([declaration])[declaration.name]?.inputSchema
  if (sent === undefined || !('jsonSchema' in sent)) throw new Error('no schema')
  return await sent.jsonSchema
}

describe('withoutVacuousPropertyNames', () => {
  it('drops propertyNames that only restates that keys are strings, at any depth', () => {
    expect(
      withoutVacuousPropertyNames({
        type: 'object',
        propertyNames: { type: 'string' },
        properties: {
          env: {
            type: 'object',
            propertyNames: { type: 'string' },
            additionalProperties: {},
          },
        },
      }),
    ).toEqual({
      type: 'object',
      properties: { env: { type: 'object', additionalProperties: {} } },
    })
  })

  it('keeps a propertyNames that actually constrains keys', () => {
    const constrained = {
      type: 'object',
      propertyNames: { type: 'string', pattern: '^[a-z]+$' },
    }
    expect(withoutVacuousPropertyNames(constrained)).toEqual(constrained)
  })

  it('keeps a property that happens to be named propertyNames', () => {
    const schema = {
      type: 'object',
      properties: { propertyNames: { type: 'string' } },
      required: ['propertyNames'],
    }
    expect(withoutVacuousPropertyNames(schema)).toEqual(schema)
  })
})

describe('toToolSet schemas', () => {
  it('sends a zod record tool without propertyNames', async () => {
    const sent = await schemaSentFor({
      name: 'bridge',
      description: 'record input',
      effect: EToolEffect.Read,
      inputSchema: z.object({
        env: z.record(z.string(), z.string()).optional(),
      }),
    })

    expect(JSON.stringify(sent)).not.toContain('propertyNames')
  })

  it('sends a raw MCP schema without vacuous propertyNames', async () => {
    const sent = await schemaSentFor({
      name: 'mcp_lookup',
      description: 'raw schema',
      effect: EToolEffect.Read,
      inputSchema: z.record(z.string(), z.unknown()),
      jsonSchema: {
        type: 'object',
        propertyNames: { type: 'string' },
        additionalProperties: {},
      },
    })

    expect(sent).toEqual({ type: 'object', additionalProperties: {} })
  })

  it('still validates against the zod schema', async () => {
    const schema = providerSafeSchema({
      inputSchema: z.strictObject({ path: z.string() }),
    })

    expect((await schema.validate?.({ path: 'a' }))?.success).toBe(true)
    expect((await schema.validate?.({ path: 1 }))?.success).toBe(false)
  })
})
