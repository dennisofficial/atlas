export interface SecretPair {
  name: string
  value: string
}

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,199}$/

export function parseEnvLines(text: string): { pairs: SecretPair[]; invalid: number[] } {
  const pairs: SecretPair[] = []
  const invalid: number[] = []
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) return
    const separator = line.indexOf('=')
    const name = separator === -1 ? '' : line.slice(0, separator).trim()
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
      invalid.push(index + 1)
      return
    }
    pairs.push({ name, value: line.slice(separator + 1) })
  })
  return { pairs, invalid }
}

export function secretsErrorOf(pairs: readonly SecretPair[]): string | null {
  const seen = new Set<string>()
  for (const pair of pairs) {
    if (!ENV_NAME_PATTERN.test(pair.name)) {
      return 'Use letters, digits, and underscores for names, not starting with a digit (maximum 200 characters).'
    }
    if (seen.has(pair.name)) return `Duplicate name: ${pair.name}. Remove or rename it.`
    if (pair.value === '') return `Enter a value for ${pair.name}.`
    seen.add(pair.name)
  }
  return null
}
