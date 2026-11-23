export type PeerRow = {
  sessionId: string
  spawnedBy?: string | null | undefined
  nested?: boolean | undefined
  archivedAt?: string | null | undefined
}

export type PeerTreeNode<Row extends PeerRow> = Row & {
  children: readonly PeerTreeNode<Row>[]
}

const isArchived = (row: PeerRow): boolean =>
  row.archivedAt !== null && row.archivedAt !== undefined

const homeOf = <Row extends PeerRow>(row: Row, byId: ReadonlyMap<string, Row>): string | null => {
  if (row.nested === false) return null
  const spawnerId = row.spawnedBy ?? null
  if (spawnerId === null || spawnerId === row.sessionId) return null
  const spawner = byId.get(spawnerId)
  if (spawner === undefined || isArchived(spawner)) return null
  return spawner.sessionId
}

export const nestPeers = <Row extends PeerRow>(
  rows: readonly Row[],
): readonly PeerTreeNode<Row>[] => {
  const byId = new Map(rows.map((row) => [row.sessionId, row]))
  const childrenBy = new Map<string, Row[]>()
  for (const row of rows) {
    const home = homeOf(row, byId)
    if (home === null) continue
    childrenBy.set(home, [...(childrenBy.get(home) ?? []), row])
  }
  const nodeOf = (row: Row): PeerTreeNode<Row> => ({
    ...row,
    children: (childrenBy.get(row.sessionId) ?? []).map(nodeOf),
  })
  return rows.filter((row) => homeOf(row, byId) === null).map(nodeOf)
}
