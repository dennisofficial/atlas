export const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)
