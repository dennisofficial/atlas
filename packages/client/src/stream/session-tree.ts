export enum EPeerBucket {
  Active = 'active',
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

export const peerBucketOf = ({ row }: { row: PeerBucketRow }): EPeerBucket =>
  isSet(row.archivedAt) ? EPeerBucket.Archived : EPeerBucket.Active

export const splitTeammates = <Row extends { archivedAt?: string | null | undefined }>(
  rows: readonly Row[],
): TeammateSplit<Row> => ({
  active: rows.filter((row) => !isSet(row.archivedAt)),
  done: rows.filter((row) => isSet(row.archivedAt)),
})
