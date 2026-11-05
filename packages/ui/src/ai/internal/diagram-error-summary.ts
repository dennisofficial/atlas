const MAX_SUMMARY_LENGTH = 160

export function summarizeDiagramError({ error }: { error: string }): string {
  const firstLine = error.trim().split('\n')[0] ?? ''
  const expectingAt = firstLine.indexOf('Expecting')
  const head = expectingAt === -1 ? firstLine : firstLine.slice(0, expectingAt)
  const summary = head.trim()
  if (summary.length > 0) return summary.slice(0, MAX_SUMMARY_LENGTH)
  return error.trim().slice(0, MAX_SUMMARY_LENGTH)
}
