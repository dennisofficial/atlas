export function parseFavourites(held: string | undefined): readonly string[] {
  if (held === undefined || held.trim() === '') return []

  try {
    const parsed: unknown = JSON.parse(held)
    if (!Array.isArray(parsed)) return []
    const named = parsed.filter((entry): entry is string => typeof entry === 'string')
    return [...new Set(named.map((entry) => entry.trim()).filter((entry) => entry.length > 0))]
  } catch {
    return []
  }
}

export const formatFavourites = (favourites: readonly string[]): string =>
  favourites.length === 0 ? '' : JSON.stringify(favourites)

export const isFavourite = (args: { favourites: readonly string[]; key: string }): boolean =>
  args.favourites.includes(args.key)

/**
 * A new pin lands at the end, so the group reads in the order it was built rather than reshuffling
 * every time something is added.
 */
export function toggleFavourite(args: {
  favourites: readonly string[]
  key: string
}): readonly string[] {
  if (isFavourite(args)) return args.favourites.filter((entry) => entry !== args.key)
  return [...args.favourites, args.key]
}
