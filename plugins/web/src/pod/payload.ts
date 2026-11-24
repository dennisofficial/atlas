export const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

export const records = (value: unknown): readonly Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
      )
    : []

export const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const bodyOf = async (response: Response): Promise<Record<string, unknown> | undefined> => {
  try {
    return recordOf(await response.json())
  } catch {
    return undefined
  }
}
