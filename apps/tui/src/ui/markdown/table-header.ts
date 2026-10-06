const PROTECTED = /(\]\([^)]*\)|<[^>\s]+>|https?:\/\/\S+)/i

export function upperTableHeader(markdown: string): string {
  const lines = markdown.split('\n')
  const header = lines[0]
  if (header === undefined) return markdown
  const upper = header
    .split(PROTECTED)
    .map((part, index) => (index % 2 === 1 ? part : part.toUpperCase()))
    .join('')
  return [upper, ...lines.slice(1)].join('\n')
}
