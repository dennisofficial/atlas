export function optionOf<T>({
  table,
  key,
  fallback,
}: {
  table: Readonly<Record<string, T>>
  key: string
  fallback: T
}): T {
  return Object.hasOwn(table, key) ? (table[key] ?? fallback) : fallback
}
