import { z } from 'zod'

import type { ToolDeclaration } from './tool'

type JsonType = 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'object' | 'array'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const jsonTypeOf = (value: unknown): JsonType => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  return 'object'
}

const typesOfBranches = (branches: unknown): ReadonlySet<string> | undefined => {
  if (!Array.isArray(branches)) return undefined
  const types = new Set<string>()
  for (const branch of branches) {
    const branchTypes = acceptedTypesOf(branch)
    if (branchTypes === undefined) return undefined
    for (const type of branchTypes) types.add(type)
  }
  return types
}

const acceptedTypesOf = (schema: unknown): ReadonlySet<string> | undefined => {
  if (!isRecord(schema)) return undefined
  const declared = schema['type']
  if (typeof declared === 'string') return new Set([declared])
  if (Array.isArray(declared)) return new Set(declared.filter((type) => typeof type === 'string'))
  if (Array.isArray(schema['enum'])) return new Set(schema['enum'].map(jsonTypeOf))
  if ('const' in schema) return new Set([jsonTypeOf(schema['const'])])
  return typesOfBranches(schema['anyOf']) ?? typesOfBranches(schema['oneOf'])
}

const parsedJsonOf = (text: string): { value: unknown } | undefined => {
  try {
    return { value: JSON.parse(text) }
  } catch {
    return undefined
  }
}

const typedValueOf = (args: { value: unknown; schema: unknown }): unknown => {
  if (typeof args.value !== 'string') return args.value
  const types = acceptedTypesOf(args.schema)
  if (types === undefined) return args.value
  if (types.has('string')) return args.value === 'null' && types.has('null') ? null : args.value
  const parsed = parsedJsonOf(args.value)
  return parsed === undefined ? args.value : parsed.value
}

export const toolJsonSchemaOf = (declaration: ToolDeclaration): unknown => {
  if (declaration.jsonSchema !== undefined) return declaration.jsonSchema
  try {
    return z.toJSONSchema(declaration.inputSchema, { io: 'input' })
  } catch {
    return {}
  }
}

// Observed on Claude (2026-11-23): a call to a tool that is not in the request's tool list gets
// every argument as a string ("false", "null", "5"), because the API has no schema to type it with.
export const typedDeferredInputOf = (args: {
  declaration: ToolDeclaration
  input: unknown
}): unknown => {
  const schema = toolJsonSchemaOf(args.declaration)
  if (!isRecord(args.input) || !isRecord(schema) || !isRecord(schema['properties'])) {
    return args.input
  }
  const properties = schema['properties']
  return Object.fromEntries(
    Object.entries(args.input).map(([field, value]) => [
      field,
      typedValueOf({ value, schema: properties[field] }),
    ]),
  )
}
