import { codeSpanRanges, rangesCover } from '@dltech/atlas-core'

const isSpace = (character: string): boolean => /\s/.test(character)
const startsName = (character: string): boolean => /[a-z]/.test(character)
const continuesName = (character: string): boolean => /[a-z0-9-]/.test(character)

export type SlashName = { name: string; end: number }

const nameAt = ({ text, from }: { text: string; from: number }): SlashName | null => {
  const head = text[from]
  if (head === undefined || !startsName(head)) return null

  let end = from + 1
  while (end < text.length) {
    const character = text[end]
    if (character === undefined || !continuesName(character)) break
    end += 1
  }

  return { name: text.slice(from, end), end }
}

export const slashNameOf = ({ text }: { text: string }): SlashName | null => {
  if (text[0] !== '/') return null
  if (rangesCover({ ranges: codeSpanRanges(text), at: 0 })) return null

  const found = nameAt({ text, from: 1 })
  if (found === null) return null

  const after = text[found.end]
  if (after !== undefined && !isSpace(after)) return null

  return found
}
