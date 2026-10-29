export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'the turn stopped for a reason it did not name'
