export const podFailureReasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
