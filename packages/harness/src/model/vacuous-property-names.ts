import { asSchema, jsonSchema, type JSONSchema7, type Schema } from 'ai'
import type { ZodType } from 'zod'

const NAMED_SUBSCHEMA_KEYWORDS = new Set([
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isVacuousPropertyNames = (value: unknown): boolean =>
  isRecord(value) && Object.keys(value).length === 1 && value['type'] === 'string'

const mapValues = (record: Record<string, unknown>, map: (value: unknown) => unknown) =>
  Object.fromEntries(Object.entries(record).map(([key, value]) => [key, map(value)]))

// zod 4 emits `propertyNames: { type: "string" }` for every z.record(z.string(), …). JSON object
// keys are always strings (RFC 8259 §4), so the keyword constrains nothing — but @ai-sdk/openai
// strips it and raises a compatibility warning per tool per request (normalizeOpenAIJsonSchema).
export function withoutVacuousPropertyNames(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutVacuousPropertyNames)
  if (!isRecord(node)) return node

  const kept: Record<string, unknown> = {}
  for (const [keyword, value] of Object.entries(node)) {
    if (keyword === 'propertyNames' && isVacuousPropertyNames(value)) continue
    kept[keyword] =
      NAMED_SUBSCHEMA_KEYWORDS.has(keyword) && isRecord(value)
        ? mapValues(value, withoutVacuousPropertyNames)
        : withoutVacuousPropertyNames(value)
  }
  return kept
}

const cleaned = (schema: unknown): JSONSchema7 => withoutVacuousPropertyNames(schema) as JSONSchema7

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  isRecord(value) && typeof value['then'] === 'function'

export function providerSafeSchema(args: {
  inputSchema: ZodType
  rawJsonSchema?: unknown
}): Schema<unknown> {
  if (args.rawJsonSchema !== undefined) return jsonSchema(cleaned(args.rawJsonSchema))

  const zodBacked = asSchema(args.inputSchema)
  const validation = zodBacked.validate === undefined ? {} : { validate: zodBacked.validate }
  return jsonSchema(() => {
    const converted = zodBacked.jsonSchema
    return isPromiseLike(converted) ? Promise.resolve(converted).then(cleaned) : cleaned(converted)
  }, validation)
}
