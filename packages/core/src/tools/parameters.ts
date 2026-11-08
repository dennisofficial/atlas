import { z, type ZodType } from 'zod'

export type ToolParameters = {
  required: readonly string[]
  optional: readonly string[]
}

const NOTHING: ToolParameters = { required: [], optional: [] }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const namesOf = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string') : []

const declaredIn = (schema: unknown): ToolParameters | undefined => {
  if (!isRecord(schema) || !isRecord(schema['properties'])) return undefined

  const required = namesOf(schema['required'])
  const optional = Object.keys(schema['properties']).filter((name) => !required.includes(name))
  return required.length === 0 && optional.length === 0 ? undefined : { required, optional }
}

export function parametersOf(args: { inputSchema: ZodType; jsonSchema?: unknown }): ToolParameters {
  const declared = declaredIn(args.jsonSchema)
  if (declared !== undefined) return declared

  try {
    return declaredIn(z.toJSONSchema(args.inputSchema, { io: 'input' })) ?? NOTHING
  } catch {
    return NOTHING
  }
}

export function toolTakesClause(args: { name: string; parameters: ToolParameters }): string {
  const { required, optional } = args.parameters
  if (required.length === 0 && optional.length === 0) return ''

  const requiredPart =
    required.length === 0
      ? `${args.name} takes no required parameter`
      : `${args.name} takes ${required.join(', ')} as required`

  return optional.length === 0
    ? `${requiredPart} and nothing else.`
    : `${requiredPart}, and also accepts ${optional.join(', ')}.`
}
