const STAR_RULE = /^ {0,3}\*[ \t]*\*[ \t]*\*[ \t*]*$/
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/
const UNDERSCORE_RULE = '___'

function closesFence({ line, fence }: { line: string; fence: string }): boolean {
  const trimmed = line.trim()
  const marker = fence.charAt(0)
  return trimmed.length >= fence.length && [...trimmed].every((char) => char === marker)
}

// remend 1.4.0 counts the `***` of a thematic break as an unclosed bold-italic run and
// appends `**` to the end of the message. An underscore rule renders the same <hr>.
export function rewriteStarRules(markdown: string): string {
  if (!markdown.includes('*')) return markdown

  let fence: string | null = null
  const lines = markdown.split('\n').map((line) => {
    if (fence !== null) {
      if (closesFence({ line, fence })) fence = null
      return line
    }
    const opening = line.match(FENCE_OPEN)
    if (opening?.[1]) {
      fence = opening[1]
      return line
    }
    return STAR_RULE.test(line) ? UNDERSCORE_RULE : line
  })

  return lines.join('\n')
}

export const starRuleHandler = {
  name: 'atlas-star-rule',
  priority: -1,
  handle: rewriteStarRules,
}
