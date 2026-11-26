import { createHash } from 'node:crypto'

const EXCLUDED = new Set(['env', 'tunnelToken'])
const MINTED_BY_DAEMON: readonly (readonly [string, ReadonlySet<string>])[] = [
  ['services.start', new Set(['serviceId'])],
]

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const fields = Object.entries(value as Record<string, unknown>)
    .filter(([, field]) => field !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([field, inner]) => `${JSON.stringify(field)}:${canonical(inner)}`)
  return `{${fields.join(',')}}`
}

const mintedOf = (op: object): ReadonlySet<string> | undefined => {
  const name = (op as { op?: unknown }).op
  return MINTED_BY_DAEMON.find(([candidate]) => candidate === name)?.[1]
}

export const stepDigestOf = (op: object): string => {
  const minted = mintedOf(op)
  const kept = Object.entries(op).filter(
    ([field]) => !EXCLUDED.has(field) && minted?.has(field) !== true,
  )
  return createHash('sha256')
    .update(canonical(Object.fromEntries(kept)))
    .digest('hex')
}
