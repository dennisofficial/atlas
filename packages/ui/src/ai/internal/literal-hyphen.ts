import type { KeyboardEvent } from 'react'

const HYPHEN = '-'

// macOS turns a typed `--` into an en dash and `---` into an em dash (smart dashes), and WebKit
// keeps doing it in a textarea of atlas-mac and Safari. A markdown table's delimiter row and a
// `--flag` both reached the agent mangled, which no renderer can undo, so the composer inserts the
// second hyphen itself and the substitution never sees a run to replace.
export function continuesHyphenRun({ caret, value }: { caret: number; value: string }): boolean {
  return caret > 0 && value.charAt(caret - 1) === HYPHEN
}

export function insertHyphenAtCaret(field: HTMLTextAreaElement): string {
  const start = field.selectionStart
  const next = `${field.value.slice(0, start)}${HYPHEN}${field.value.slice(field.selectionEnd)}`
  field.value = next
  field.setSelectionRange(start + 1, start + 1)
  return next
}

export function handleLiteralHyphen({
  event,
  onValue,
}: {
  event: KeyboardEvent<HTMLTextAreaElement>
  onValue: (value: string) => void
}): boolean {
  if (event.key !== HYPHEN || event.metaKey || event.ctrlKey || event.altKey) return false
  const field = event.currentTarget
  if (field.readOnly) return false
  if (!continuesHyphenRun({ caret: field.selectionStart, value: field.value })) return false
  event.preventDefault()
  onValue(insertHyphenAtCaret(field))
  return true
}
