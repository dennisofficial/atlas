export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/[\s@._-]+/)
    .filter((word) => word.length > 0)
  const first = words[0]?.[0]
  if (first === undefined) return '?'
  const last = words.length > 1 ? words[words.length - 1]?.[0] : undefined
  return `${first}${last ?? ''}`.toUpperCase()
}
