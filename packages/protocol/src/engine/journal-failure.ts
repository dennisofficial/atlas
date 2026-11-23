const codeOf = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const journalFailureMessage = (args: { error: unknown; what: string }): string =>
  codeOf(args.error) === 'ENOSPC'
    ? `${args.what}: the sandbox disk is full (ENOSPC). Free space or wait for the disk to grow.`
    : `${args.what}: ${messageOf(args.error)}`
