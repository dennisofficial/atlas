const MAX_WARNING_CHARS = 4096

const HEADER =
  'Workspace setup did not finish cleanly. The session continues, so the workspace may be incomplete. What failed:'

const ELLIPSIS = '…'

export const setupWarningText = (warnings: readonly string[]): string => {
  const prefix = `${HEADER}\n\n`
  const body = warnings.join('\n\n')
  const room = MAX_WARNING_CHARS - prefix.length
  if (body.length <= room) return `${prefix}${body}`
  return `${prefix}${ELLIPSIS}${body.slice(body.length - (room - ELLIPSIS.length))}`
}
