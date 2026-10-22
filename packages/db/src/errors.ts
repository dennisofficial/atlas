const UNIQUE_VIOLATION = '23505'

function fieldOf({ value, key }: { value: unknown; key: string }): unknown {
  if (typeof value !== 'object' || value === null) return undefined
  return Reflect.get(value, key)
}

export function isUniqueViolation(error: unknown): boolean {
  return fieldOf({ value: error, key: 'sqlState' }) === UNIQUE_VIOLATION
}

export function violatedConstraint(error: unknown): string | undefined {
  if (!isUniqueViolation(error)) return undefined
  const constraint = fieldOf({ value: fieldOf({ value: error, key: 'cause' }), key: 'constraint' })
  return typeof constraint === 'string' ? constraint : undefined
}
