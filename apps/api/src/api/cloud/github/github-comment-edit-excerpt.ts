export function editExcerptOf({
  before,
  after,
}: {
  before: string | undefined
  after: string
}): string {
  if (before === undefined) return after
  const remaining = new Map<string, number>()
  for (const line of before.split('\n').map((entry) => entry.trimEnd())) {
    remaining.set(line, (remaining.get(line) ?? 0) + 1)
  }
  const added: string[] = []
  for (const line of after.split('\n').map((entry) => entry.trimEnd())) {
    const count = remaining.get(line) ?? 0
    if (count > 0) {
      remaining.set(line, count - 1)
      continue
    }
    if (line.trim() !== '') added.push(line)
  }
  return added.length === 0 ? after : added.join('\n')
}
