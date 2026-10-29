import { ESecretsScope, type LibrarySecret } from '../../settings/fixtures/settings-library'

export type SecretEntry = { key: string; value: string }

function unquote(value: string): string {
  const quote = value[0]
  if (value.length >= 2 && (quote === '"' || quote === "'") && value.endsWith(quote)) {
    return value.slice(1, -1)
  }
  return value
}

export function parseEnvText({ text }: { text: string }): SecretEntry[] {
  return text
    .split('\n')
    .map((line) => line.trim().replace(/^export\s+/, ''))
    .filter((line) => line.length > 0 && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=')
      return {
        key: line.slice(0, index).trim(),
        value: unquote(line.slice(index + 1).trim()),
      }
    })
    .filter((entry) => entry.key.length > 0)
}

export function overriddenKeys(rows: readonly LibrarySecret[]): Set<string> {
  const projectKeys = new Set(
    rows.filter((row) => row.scope === ESecretsScope.Project).map((row) => row.key),
  )
  return new Set(
    rows
      .filter((row) => row.scope === ESecretsScope.Personal && projectKeys.has(row.key))
      .map((row) => row.key),
  )
}

export function upsertEntries({
  rows,
  entries,
  scope,
}: {
  rows: readonly LibrarySecret[]
  entries: readonly SecretEntry[]
  scope: ESecretsScope
}): LibrarySecret[] {
  const incoming = new Set(entries.map((entry) => entry.key))
  const kept = rows.filter((row) => row.scope !== scope || !incoming.has(row.key))
  const added = entries.map((entry) => ({
    id: `${scope}-${entry.key}`,
    ...entry,
    updated: 'just now',
    scope,
  }))
  return [...added, ...kept]
}

export function updateEntry({
  rows,
  entry,
  scope,
}: {
  rows: readonly LibrarySecret[]
  entry: SecretEntry
  scope: ESecretsScope
}): LibrarySecret[] {
  return rows.map((row) =>
    row.scope === scope && row.key === entry.key
      ? { ...row, value: entry.value || row.value, updated: 'just now' }
      : row,
  )
}

export function partitionByScope({
  rows,
  scope,
}: {
  rows: readonly LibrarySecret[]
  scope: ESecretsScope
}) {
  return {
    own: rows.filter((row) => row.scope === scope),
    inherited: rows.filter((row) => row.scope !== scope),
  }
}
