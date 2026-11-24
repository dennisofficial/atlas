import { fencedLines } from '../../lib/markdown-fences'

const LEADING_WHITESPACE = /^[ \t]+/
const LIST_ITEM = /^[ \t]*([-+*]|\d{1,9}[.)])([ \t]|$)/
const OTHER_BLOCK = /^[ \t]*(#{1,6}([ \t]|$)|>|\||([-_*=][ \t]*){3,}$)/
const NON_BREAKING_SPACE = '\u00a0'

function nonBreaking(whitespace: string): string {
  return [...whitespace].map((char) => NON_BREAKING_SPACE.repeat(char === '\t' ? 4 : 1)).join('')
}

// CommonMark strips the leading spaces of every paragraph line, so text a person indented by hand
// (pasted json, a code sketch) rendered flat. Non-breaking spaces are not stripped.
export function keepLeadingSpaces(markdown: string): string {
  if (!/\n[ \t]/.test(markdown) && !LEADING_WHITESPACE.test(markdown)) return markdown
  const lines = markdown.split('\n')
  const fenced = fencedLines(lines)
  let inList = false
  let afterBlank = false

  return lines
    .map((line, index) => {
      if (fenced[index] === true) return line
      if (line.trim() === '') {
        afterBlank = true
        return line
      }
      const wasAfterBlank = afterBlank
      afterBlank = false
      if (LIST_ITEM.test(line)) {
        inList = true
        return line
      }
      const leading = LEADING_WHITESPACE.exec(line)?.[0]
      if (leading === undefined) {
        if (wasAfterBlank) inList = false
        return line
      }
      if (inList || OTHER_BLOCK.test(line)) return line
      return nonBreaking(leading) + line.slice(leading.length)
    })
    .join('\n')
}
