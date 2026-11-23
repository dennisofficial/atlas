import { describe, expect, it } from 'bun:test'

import { z } from 'zod'

import { typedDeferredInputOf } from '../deferred-input'
import { EToolEffect, type ToolDeclaration } from '../tool'

const routineLike: ToolDeclaration = {
  name: 'routine',
  description: 'Manage routines',
  effect: EToolEffect.Write,
  deferred: true,
  inputSchema: z.strictObject({
    action: z.enum(['get', 'update']),
    routineId: z.string().optional(),
    enabled: z.boolean().optional(),
    model: z.string().min(1).nullable().optional(),
    fast: z.boolean().nullable().optional(),
    limit: z.number().optional(),
    tags: z.array(z.string()).optional(),
  }),
}

const typed = (input: unknown): unknown => typedDeferredInputOf({ declaration: routineLike, input })

describe('typed deferred input', () => {
  it('turns stringified booleans, nulls, numbers and arrays back into their schema types', () => {
    expect(
      typed({
        action: 'update',
        routineId: 'r-1',
        enabled: 'false',
        fast: 'null',
        model: 'null',
        limit: '5',
        tags: '["a","b"]',
      }),
    ).toEqual({
      action: 'update',
      routineId: 'r-1',
      enabled: false,
      fast: null,
      model: null,
      limit: 5,
      tags: ['a', 'b'],
    })
  })

  it('keeps values that already have their type', () => {
    const input = { action: 'update', routineId: 'r-1', enabled: false, fast: null, model: null }
    expect(typed(input)).toEqual(input)
  })

  it('keeps a string where the schema takes a string', () => {
    expect(typed({ action: 'get', routineId: 'true', model: 'opus' })).toEqual({
      action: 'get',
      routineId: 'true',
      model: 'opus',
    })
  })

  it('leaves text that is not JSON for the schema to reject', () => {
    expect(typed({ action: 'update', enabled: 'nope' })).toEqual({
      action: 'update',
      enabled: 'nope',
    })
  })

  it('follows a raw JSON schema an MCP server declared', () => {
    const declaration: ToolDeclaration = {
      ...routineLike,
      jsonSchema: { type: 'object', properties: { verbose: { type: 'boolean' } } },
    }
    expect(typedDeferredInputOf({ declaration, input: { verbose: 'true' } })).toEqual({
      verbose: true,
    })
  })
})
