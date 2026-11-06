export type SigningWindowRow = { validUntil: number; sealed: string }

export interface MediaSigningWindows {
  find(windowStart: number): Promise<SigningWindowRow | null>
  insertIfAbsent(args: { windowStart: number; validUntil: number; sealed: string }): Promise<void>
}
