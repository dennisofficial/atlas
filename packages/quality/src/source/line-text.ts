export function splitLines(content: string): string[] {
  if (content === '') return []

  const lines = content.split('\n')
  if (lines.at(-1) === '') lines.pop()

  return lines
}

export const isNewlineTerminated = (content: string): boolean =>
  content === '' || content.endsWith('\n')
