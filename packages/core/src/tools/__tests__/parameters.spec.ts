import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { parametersOf, toolTakesClause } from '../parameters'

describe('parametersOf', () => {
  it('reads the required and optional names off a zod schema', () => {
    const parameters = parametersOf({
      inputSchema: z.strictObject({ command: z.string(), watch: z.string().optional() }),
    })

    expect(parameters).toEqual({ required: ['command'], optional: ['watch'] })
  })

  it('reads through a schema that transforms its input', () => {
    const parameters = parametersOf({
      inputSchema: z
        .strictObject({ command: z.string(), workdir: z.string().optional() })
        .transform((input) => ({ ...input, named: true })),
    })

    expect(parameters).toEqual({ required: ['command'], optional: ['workdir'] })
  })

  it('prefers the raw schema an MCP server declared', () => {
    const parameters = parametersOf({
      inputSchema: z.record(z.string(), z.unknown()),
      jsonSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    })

    expect(parameters).toEqual({ required: ['query'], optional: [] })
  })

  it('says nothing about a schema that declares no parameters', () => {
    expect(parametersOf({ inputSchema: z.record(z.string(), z.unknown()) })).toEqual({
      required: [],
      optional: [],
    })
  })
})

describe('toolTakesClause', () => {
  it('names the required parameters and the optional ones', () => {
    expect(
      toolTakesClause({
        name: 'bash',
        parameters: { required: ['command'], optional: ['description', 'workdir'] },
      }),
    ).toBe('bash takes command as required, and also accepts description, workdir.')
  })

  it('says so when nothing is optional', () => {
    expect(
      toolTakesClause({ name: 'read', parameters: { required: ['path'], optional: [] } }),
    ).toBe('read takes path as required and nothing else.')
  })

  it('says nothing when the parameters are unknown', () => {
    expect(toolTakesClause({ name: 'mcp', parameters: { required: [], optional: [] } })).toBe('')
  })
})
