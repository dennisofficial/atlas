const NONE: ReadonlySet<string> = new Set()

export const freshKeysOf = ({
  previous,
  next,
}: {
  previous: ReadonlySet<string>
  next: readonly string[]
}): ReadonlySet<string> => {
  if (previous.size === 0) return NONE
  const fresh = next.filter((key) => !previous.has(key))
  return fresh.length === 0 ? NONE : new Set(fresh)
}
