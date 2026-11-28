export const SECRET_NAME = /^[A-Z_][A-Z0-9_]*$/

export interface SecretPair {
  name: string
  value: string
}

export function parseEnvLines(text: string): { pairs: SecretPair[]; invalid: number[] } {
  const pairs: SecretPair[] = []
  const invalid: number[] = []
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) return
    const separator = line.indexOf('=')
    const name = separator === -1 ? '' : line.slice(0, separator).trim()
    if (!SECRET_NAME.test(name)) {
      invalid.push(index + 1)
      return
    }
    pairs.push({ name, value: line.slice(separator + 1) })
  })
  return { pairs, invalid }
}
