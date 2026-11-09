import { mapLinesOutsideFences } from './markdown-fences'

const STAR_RULE = /^ {0,3}\*[ \t]*\*[ \t]*\*[ \t*]*$/
const UNDERSCORE_RULE = '___'

// remend 1.4.0 counts the `***` of a thematic break as an unclosed bold-italic run and
// appends `**` to the end of the message. An underscore rule renders the same <hr>.
export function rewriteStarRules(markdown: string): string {
  if (!markdown.includes('*')) return markdown

  return mapLinesOutsideFences({
    markdown,
    rewrite: ({ line }) => (STAR_RULE.test(line) ? UNDERSCORE_RULE : line),
  })
}

export const starRuleHandler = {
  name: 'atlas-star-rule',
  priority: -1,
  handle: rewriteStarRules,
}
