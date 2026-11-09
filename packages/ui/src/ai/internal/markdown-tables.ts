import { mapLinesOutsideFences } from './markdown-fences'

const DASH_LIKE = /[—–‒―−]/
const ALL_DASH_LIKE = /[—–‒―−]/g
const DELIMITER_CELL = /^:?[\s\-—–‒―−]*:?$/

function cellsOf(line: string): string[] {
  const trimmed = line.trim()
  const withoutEdges = trimmed.replace(/^\|/, '').replace(/\|$/, '')
  return withoutEdges.split('|').map((cell) => cell.trim())
}

function isDelimiterRow(line: string): boolean {
  if (!line.includes('|')) return false
  const cells = cellsOf(line)
  if (cells.length === 0) return false

  return (
    cells.every((cell) => cell.length > 0 && DELIMITER_CELL.test(cell)) &&
    cells.some((cell) => DASH_LIKE.test(cell))
  )
}

// Models write a delimiter row with a dash as the cell (`| --- | — |`); micromark only accepts
// hyphens, so the whole table falls back to a paragraph. Repairing the row is invisible when the
// markdown is already valid.
export function repairTableDelimiters(markdown: string): string {
  if (!DASH_LIKE.test(markdown)) return markdown

  return mapLinesOutsideFences({
    markdown,
    rewrite: ({ line, previous }) =>
      previous?.includes('|') === true && isDelimiterRow(line)
        ? line.replace(ALL_DASH_LIKE, '-')
        : line,
  })
}
