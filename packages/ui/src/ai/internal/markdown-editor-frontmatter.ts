const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/
const PLAIN_ENTRY = /^([A-Za-z0-9_-]+):[ \t]+(.+)$/
const ALREADY_STRUCTURED = /^["'[{|>]/
const AMBIGUOUS_IN_YAML = /: | #/

const quoted = (value: string): string =>
  `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`

const quoteEntry = (line: string): string => {
  const match = PLAIN_ENTRY.exec(line)
  if (match === null) return line
  const [, key, value = ''] = match
  if (ALREADY_STRUCTURED.test(value) || !AMBIGUOUS_IN_YAML.test(value)) return line
  return `${key}: ${quoted(value)}`
}

export function quoteAmbiguousFrontmatter(markdown: string): string {
  const block = FRONTMATTER_BLOCK.exec(markdown)
  if (block === null) return markdown
  const entries = block[1] ?? ''
  const fixed = entries.split('\n').map(quoteEntry).join('\n')
  if (fixed === entries) return markdown
  return markdown.replace(entries, fixed)
}
