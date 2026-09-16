import { join } from 'node:path'
import { readdirSync } from 'node:fs'

export function pendingMigrations(args: {
  shipped: readonly string[]
  applied: readonly string[]
}): readonly string[] {
  const applied = new Set(args.applied)
  return [...args.shipped].filter((name) => !applied.has(name)).sort()
}

export function shippedMigrationNames(args: { directory?: string } = {}): readonly string[] {
  const directory = args.directory ?? join(__dirname, '..', '..', '..', 'prisma', 'migrations')

  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}
