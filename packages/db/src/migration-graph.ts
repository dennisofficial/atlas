import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const MIGRATIONS_DIRECTORY = join(import.meta.dirname, '..', 'migrations', 'app')

type MigrationManifest = { from: string | null; to: string }

export function migrationGraphHashes({ directory = MIGRATIONS_DIRECTORY }: { directory?: string } = {}): string[] {
  const hashes = new Set<string>()
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'refs') continue
    const manifest: MigrationManifest = JSON.parse(readFileSync(join(directory, entry.name, 'migration.json'), 'utf8'))
    if (manifest.from) hashes.add(manifest.from)
    hashes.add(manifest.to)
  }
  return [...hashes].sort()
}
