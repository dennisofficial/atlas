import { ECleanupReason, reasonFor, type SourceObservation } from './cleanup-reasons'

export const uniqueReasons = (reasons: readonly string[]): string[] => [...new Set(reasons)]

export const sameList = ({ left, right }: { left: readonly string[]; right: readonly string[] }): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index])

export function capturedAdminBaseline({
  hasRepository,
  captured,
  observedDigest,
}: {
  hasRepository: boolean
  captured: string | null | undefined
  observedDigest: string | null
}): { digest: string | null; reasons: string[] } {
  if (!hasRepository) return { digest: null, reasons: [] }
  if (typeof captured !== 'string') {
    return {
      digest: null,
      reasons: [reasonFor({ code: ECleanupReason.AdminBaselineMissing, detail: 'the archive recorded no git administration digest' })],
    }
  }
  if (observedDigest === captured) return { digest: captured, reasons: [] }
  return {
    digest: captured,
    reasons: [reasonFor({ code: ECleanupReason.AdminBaselineMismatch, detail: 'the source administration differs from the archived capture' })],
  }
}

export function sessionRetentionReasons({
  proofSessionId,
  sourceSessionId,
}: {
  proofSessionId: string
  sourceSessionId: string
}): string[] {
  return proofSessionId === sourceSessionId
    ? []
    : [reasonFor({ code: ECleanupReason.SessionChanged, detail: `${proofSessionId} -> ${sourceSessionId}` })]
}

export function cleanupDriftReasons({
  observed,
  proof,
}: {
  observed: SourceObservation
  proof: { cwd: string; registryRoots: readonly string[]; adminDigest: string | null }
}): string[] {
  const reasons = [...observed.reasons]
  if (!sameList({ left: observed.registryRoots, right: proof.registryRoots })) {
    reasons.push(reasonFor({ code: ECleanupReason.RegistryChanged, detail: observed.registryRoots.join(', ') }))
  }
  if (observed.adminDigest !== proof.adminDigest) {
    reasons.push(reasonFor({ code: ECleanupReason.AdminDrift, detail: proof.cwd }))
  }
  return reasons
}
