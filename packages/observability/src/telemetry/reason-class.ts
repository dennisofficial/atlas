/**
 * A denial or failure reason can quote a path or a user's words, so telemetry sends only a coarse
 * class derived from fixed prefixes in the reason — the full text never leaves the log.
 */
export function reasonClassOf(reason: string): string {
  const head = reason.trim().toLowerCase()

  if (head.startsWith('refusing to write')) return 'write-refusal'
  if (head.startsWith('write would replace all')) return 'write-replaces-whole-file'
  if (head.startsWith('edit would change part')) return 'edit-partial-change'
  if (head.startsWith('the sandbox owns')) return 'sandbox-owns-transcript'
  if (head.startsWith('no tool named')) return 'unknown-tool'
  if (head.startsWith('the ') && head.includes(' tool rejected this input')) return 'invalid-input'

  return 'other'
}
