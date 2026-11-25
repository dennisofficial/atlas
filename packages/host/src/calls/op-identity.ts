import { createHash } from 'node:crypto'

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const fields = Object.entries(value as Record<string, unknown>)
    .filter(([, field]) => field !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([key, field]) => `${JSON.stringify(key)}:${canonical(field)}`)
  return `{${fields.join(',')}}`
}

export const opIdentityOf = (op: object): string =>
  createHash('sha256').update(canonical(op)).digest('hex').slice(0, 12)
