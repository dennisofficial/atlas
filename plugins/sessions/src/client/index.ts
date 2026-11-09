export type PeerRow = {
  sessionId: string
  spawnedBy?: string | null | undefined
  archivedAt?: string | null | undefined
}

export type PeerTreeNode<Row extends PeerRow> = Row & {
  children: readonly PeerTreeNode<Row>[]
}

export const nestPeers = <Row extends PeerRow>(
  rows: readonly Row[],
): readonly PeerTreeNode<Row>[] => {
  const known = new Set(rows.map((row) => row.sessionId))
  const childrenBy = new Map<string, Row[]>()
  for (const row of rows) {
    const spawner = row.spawnedBy ?? null
    if (spawner === null || !known.has(spawner)) continue
    childrenBy.set(spawner, [...(childrenBy.get(spawner) ?? []), row])
  }
  const nodeOf = (row: Row): PeerTreeNode<Row> => ({
    ...row,
    children: (childrenBy.get(row.sessionId) ?? []).map(nodeOf),
  })
  return rows
    .filter((row) => {
      const spawner = row.spawnedBy ?? null
      return spawner === null || !known.has(spawner)
    })
    .map(nodeOf)
}
