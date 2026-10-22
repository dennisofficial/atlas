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

export function databaseErrorCode(error: unknown): string | undefined {
  const state = fieldOf({ value: error, key: 'sqlState' }) ?? fieldOf({ value: error, key: 'code' })
  return typeof state === 'string' && /^[0-9A-Z]{5}$/.test(state) ? state : undefined
}

export function isNoRows(error: unknown): boolean {
  return fieldOf({ value: error, key: 'code' }) === 'RUNTIME.NO_ROWS'
}
