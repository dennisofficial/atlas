import { INACTIVE_AFTER_MS } from './project-recency'

export enum EPeerBucket {
  Active = 'active',
  Inactive = 'inactive',
  Archived = 'archived',
}

export type PeerBucketRow = {
  updatedAt: string
  pinnedAt?: string | null | undefined
  archivedAt?: string | null | undefined
}

export type TeammateSplit<Row> = {
  active: Row[]
  done: Row[]
}

const isSet = (stamp: string | null | undefined): boolean => stamp !== null && stamp !== undefined

export const peerBucketOf = ({ row, now }: { row: PeerBucketRow; now: number }): EPeerBucket => {
  if (isSet(row.archivedAt)) return EPeerBucket.Archived
  if (isSet(row.pinnedAt)) return EPeerBucket.Active
  const updatedAt = Date.parse(row.updatedAt)
  if (Number.isNaN(updatedAt)) return EPeerBucket.Active
  return now - updatedAt > INACTIVE_AFTER_MS ? EPeerBucket.Inactive : EPeerBucket.Active
}

export const splitTeammates = <Row extends { archivedAt?: string | null | undefined }>(
  rows: readonly Row[],
): TeammateSplit<Row> => ({
  active: rows.filter((row) => !isSet(row.archivedAt)),
  done: rows.filter((row) => isSet(row.archivedAt)),
})
