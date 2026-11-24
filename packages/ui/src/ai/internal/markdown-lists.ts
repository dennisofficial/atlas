import { mapLinesOutsideFences } from '../../lib/markdown-fences'

const LIST_MARKER = /^( *)([-+*]|\d{1,9}[.)])( +|$)/
const HAS_INDENTED_LINE = /\n {2,}\S/

type OpenItem = {
  markerIndent: number
  contentColumn: number
  outputContentColumn: number
}

function childThreshold(item: OpenItem): number {
  return Math.min(item.markerIndent + 2, item.contentColumn)
}

function markerWidth({ marker, spaces }: { marker: string; spaces: string }): number {
  const gap = spaces.length === 0 || spaces.length > 4 ? 1 : spaces.length
  return marker.length + gap
}

// CommonMark nests a line under a list item only at the item's content column (3 spaces under
// `1. `), so the two-space indent people type for a sub-list renders flat. Re-indent such children
// to the content column; a list that already nests keeps its bytes.
export function nestUnderIndentedListItems(markdown: string): string {
  if (!HAS_INDENTED_LINE.test(markdown)) return markdown
  const open: OpenItem[] = []

  return mapLinesOutsideFences({
    markdown,
    rewrite: ({ line }) => {
      if (line.trim() === '') return line
      const indent = line.length - line.trimStart().length
      const leadingSpaces = /^ */.exec(line)?.[0].length ?? 0
      if (leadingSpaces !== indent) {
        open.length = 0
        return line
      }
      while (open.length > 0 && indent < childThreshold(open[open.length - 1] as OpenItem)) {
        open.pop()
      }
      const parent = open[open.length - 1]
      const outputIndent = indentUnder({ parent, indent })
      const marker = LIST_MARKER.exec(line)
      if (marker?.[2] !== undefined) {
        const width = markerWidth({ marker: marker[2], spaces: marker[3] ?? '' })
        open.push({
          markerIndent: indent,
          contentColumn: indent + width,
          outputContentColumn: outputIndent + width,
        })
      }
      return ' '.repeat(outputIndent) + line.slice(indent)
    },
  })
}

function indentUnder({ parent, indent }: { parent: OpenItem | undefined; indent: number }): number {
  if (parent === undefined) return indent
  if (indent < parent.contentColumn) return parent.outputContentColumn
  return indent + parent.outputContentColumn - parent.contentColumn
}
