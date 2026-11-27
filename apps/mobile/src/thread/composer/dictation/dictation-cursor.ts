export interface IDictationCursor {
  focus: () => void
  blur: () => void
  select: (selection: { start: number }) => void
  suspend: () => void
  settle: (params: { at: number }) => void
  insertAt: (params: { textLength: number }) => number
}

export const createDictationCursor = (): IDictationCursor => {
  let focused = false
  let caret: number | null = null
  return {
    focus: () => {
      focused = true
    },
    blur: () => {
      focused = false
    },
    select: ({ start }) => {
      if (focused) caret = start
    },
    suspend: () => {
      focused = false
    },
    settle: ({ at }) => {
      focused = false
      caret = at
    },
    insertAt: ({ textLength }) => {
      if (caret === null) return textLength
      return Math.min(Math.max(caret, 0), textLength)
    },
  }
}
