export function enumValueOf<T extends string>({
  options,
  value,
  fallback,
}: {
  options: readonly T[]
  value: string
  fallback: T
}): T {
  return options.find((option) => option === value) ?? fallback
}
