const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/

function closesFence({ line, fence }: { line: string; fence: string }): boolean {
  const trimmed = line.trim()
  const marker = fence.charAt(0)
  return trimmed.length >= fence.length && [...trimmed].every((char) => char === marker)
}

export function fencedLines(lines: string[]): boolean[] {
  let fence: string | null = null

  return lines.map((line) => {
    if (fence !== null) {
      if (closesFence({ line, fence })) fence = null
      return true
    }
    const opening = line.match(FENCE_OPEN)
    if (!opening?.[1]) return false
    fence = opening[1]
    return true
  })
}

export function mapLinesOutsideFences({
  markdown,
  rewrite,
}: {
  markdown: string
  rewrite: (args: { line: string; previous: string | undefined }) => string
}): string {
  const lines = markdown.split('\n')
  const fenced = fencedLines(lines)

  return lines
    .map((line, index) =>
      fenced[index] === true ? line : rewrite({ line, previous: lines[index - 1] }),
    )
    .join('\n')
}
