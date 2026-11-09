const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/

function closesFence({ line, fence }: { line: string; fence: string }): boolean {
  const trimmed = line.trim()
  const marker = fence.charAt(0)
  return trimmed.length >= fence.length && [...trimmed].every((char) => char === marker)
}

export function mapLinesOutsideFences({
  markdown,
  rewrite,
}: {
  markdown: string
  rewrite: (args: { line: string; previous: string | undefined }) => string
}): string {
  let fence: string | null = null
  const lines = markdown.split('\n')

  return lines
    .map((line, index) => {
      if (fence !== null) {
        if (closesFence({ line, fence })) fence = null
        return line
      }
      const opening = line.match(FENCE_OPEN)
      if (opening?.[1]) {
        fence = opening[1]
        return line
      }
      return rewrite({ line, previous: lines[index - 1] })
    })
    .join('\n')
}
