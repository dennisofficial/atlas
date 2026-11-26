export const effortSliderMaxOf = (efforts: readonly string[]): number =>
  Math.max(efforts.length - 1, 0)

export const effortIndexIn = ({
  efforts,
  effort,
}: {
  efforts: readonly string[]
  effort: string
}): number => {
  const index = efforts.indexOf(effort)
  return Math.max(index, 0)
}

export const effortAtIndex = ({
  efforts,
  index,
}: {
  efforts: readonly string[]
  index: number
}): string | null => {
  if (efforts.length === 0) return null
  const at = Math.min(Math.max(Math.round(index), 0), efforts.length - 1)
  return efforts[at] ?? null
}
