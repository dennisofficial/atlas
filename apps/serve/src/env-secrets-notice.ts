export const envSecretsNoticeOf = (names: readonly string[]): string | null => {
  if (names.length === 0) return null
  return [
    `Atlas exported these project and personal secrets as environment variables to your shells and services: ${names.join(', ')}.`,
    'Use them by name (for example "$NAME" in a command) rather than asking the operator for them, and never print, log or commit their values.',
    'Change them in the project or personal Secrets settings; edits reach new turns without a restart.',
  ].join('\n\n')
}
