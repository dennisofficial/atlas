import { createHash } from 'node:crypto'

const EXCLUDED = new Set(['env', 'tunnelToken'])

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const fields = Object.entries(value as Record<string, unknown>)
    .filter(([, field]) => field !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([field, inner]) => `${JSON.stringify(field)}:${canonical(inner)}`)
  return `{${fields.join(',')}}`
}

export const stepDigestOf = (op: object): string =>
  createHash('sha256')
    .update(
      canonical(Object.fromEntries(Object.entries(op).filter(([field]) => !EXCLUDED.has(field)))),
    )
    .digest('hex')
