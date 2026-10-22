import { migrationGraphHashes } from '@dltech/atlas-db/migrations'

export enum EContractDrift {
  Level = 'level',
  Behind = 'behind',
  Ahead = 'ahead',
}

export function contractDrift({
  expected,
  marker,
  graph,
}: {
  expected: string
  marker: string | null
  graph: readonly string[]
}): EContractDrift {
  if (marker === expected) return EContractDrift.Level
  if (marker === null || graph.includes(marker)) return EContractDrift.Behind
  return EContractDrift.Ahead
}

declare const __ATLAS_MIGRATION_GRAPH__: readonly string[] | undefined

export function shippedMigrationGraph(): readonly string[] {
  if (typeof __ATLAS_MIGRATION_GRAPH__ !== 'undefined') return __ATLAS_MIGRATION_GRAPH__
  return migrationGraphHashes()
}
