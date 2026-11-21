export const MEMORY_INDEX_DESCRIPTION_CHARS = 200
export const MEMORY_INDEX_ADVISORY_CHARS = 12_000
export const MEMORY_INDEX_RECONCILE_CHARS = 20_000

export enum EIndexPressure {
  Clear = 0,
  Advisory = 1,
  Reconcile = 2,
}

export const indexPressureOf = (indexChars: number): EIndexPressure => {
  if (indexChars >= MEMORY_INDEX_RECONCILE_CHARS) return EIndexPressure.Reconcile
  if (indexChars >= MEMORY_INDEX_ADVISORY_CHARS) return EIndexPressure.Advisory
  return EIndexPressure.Clear
}

export const descriptionBudgetRefusal = (description: string): string | undefined => {
  if (description.length <= MEMORY_INDEX_DESCRIPTION_CHARS) return undefined
  return [
    `The description has ${description.length} characters. The limit is ${MEMORY_INDEX_DESCRIPTION_CHARS} characters, because every model request carries the description in the memory index.`,
    'Write one claim in the description. Move the reason and the details into the body. Then write the memory again.',
  ].join(' ')
}
