export enum ECleanupReason {
  InspectionFailed = 'inspection-failed',
  UnrelatedCheckout = 'unrelated-checkout',
  UnusableCheckout = 'unusable-checkout',
  UnregisteredRoot = 'unregistered-covered-root',
  AmbiguousRoot = 'ambiguous-root',
  FingerprintDrift = 'fingerprint-drift',
  AdminDrift = 'administration-drift',
  RegistryChanged = 'registry-changed',
  SessionChanged = 'session-changed',
  AdminBaselineMissing = 'administration-baseline-missing',
  AdminBaselineMismatch = 'administration-baseline-mismatch',
}

export type SourceObservation = {
  cwd: string
  registryRoots: readonly string[]
  adminDigest: string | null
  reasons: readonly string[]
}

export const reasonFor = ({ code, detail }: { code: ECleanupReason; detail: string }): string => `${code}: ${detail}`

export const describeFailure = (error: unknown): string => (error instanceof Error ? error.message : String(error))
