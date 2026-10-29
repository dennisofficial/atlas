export const withinFamily = ({
  row,
  confinedTo,
}: {
  row: { id: string; spawnerThreadId: string | null }
  confinedTo: string | undefined
}): boolean =>
  confinedTo === undefined || row.id === confinedTo || row.spawnerThreadId === confinedTo
