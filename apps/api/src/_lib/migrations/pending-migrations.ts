import { join } from 'node:path'
import { readdirSync } from 'node:fs'

export function pendingMigrations(args: {
  shipped: readonly string[]
  applied: readonly string[]
}): readonly string[] {
  const applied = new Set(args.applied)
  return [...args.shipped].filter((name) => !applied.has(name)).sort()
}

declare const __ATLAS_SHIPPED_MIGRATIONS__: readonly string[] | undefined

export function shippedMigrationNames(args: { directory?: string } = {}): readonly string[] {
  if (args.directory === undefined && typeof __ATLAS_SHIPPED_MIGRATIONS__ !== 'undefined') {
    return __ATLAS_SHIPPED_MIGRATIONS__
  }

  const directory = args.directory ?? join(import.meta.dirname, '..', '..', '..', 'prisma', 'migrations')

  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}
