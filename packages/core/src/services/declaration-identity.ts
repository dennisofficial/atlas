import { FNV_OFFSET, FNV_PRIME } from './port'
import type { ServiceDeclaration } from './declaration'

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function declarationHash(declaration: ServiceDeclaration): string {
  let hash = FNV_OFFSET
  for (const character of canonical(declaration)) {
    hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), FNV_PRIME) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
