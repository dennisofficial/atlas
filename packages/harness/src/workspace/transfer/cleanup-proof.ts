import {
  describeFailure,
  ECleanupReason,
  observeSource,
  reasonFor,
  type SourceObservation,
} from './cleanup-proof-inspect'
import type { WorkspaceManifest } from './manifest'

export { ECleanupReason } from './cleanup-proof-inspect'

export type SourceCleanupProof = {
  generation: string
  sessionId: string
  manifest: WorkspaceManifest
  cwd: string
  registryRoots: string[]
  adminDigest: string | null
  retentionReasons: string[]
}

export type SourceCleanupVerdict = { safe: boolean; reasons: string[] }

const unique = (reasons: readonly string[]): string[] => [...new Set(reasons)]

const sameList = ({ left, right }: { left: readonly string[]; right: readonly string[] }): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index])

const observeSafely = async ({ cwd, manifest }: { cwd: string; manifest: WorkspaceManifest }): Promise<SourceObservation> => {
  try {
    return await observeSource({ cwd, manifest })
  } catch (error) {
    const detail = describeFailure(error)
    return { cwd, registryRoots: [], adminDigest: null, reasons: [reasonFor({ code: ECleanupReason.InspectionFailed, detail })] }
  }
}

export async function captureSourceCleanupProof({
  cwd,
  manifest,
  generation,
  sourceSessionId,
}: {
  cwd: string
  manifest: WorkspaceManifest
  generation: string
  sourceSessionId: string
}): Promise<SourceCleanupProof> {
  const observed = await observeSafely({ cwd, manifest })
  return {
    generation,
    sessionId: sourceSessionId,
    manifest,
    cwd: observed.cwd,
    registryRoots: [...observed.registryRoots],
    adminDigest: observed.adminDigest,
    retentionReasons: unique(observed.reasons),
  }
}

export async function verifySourceCleanupProof({
  proof,
  sourceSessionId,
}: {
  proof: SourceCleanupProof
  sourceSessionId: string
}): Promise<SourceCleanupVerdict> {
  const early = proof.sessionId === sourceSessionId
    ? []
    : [reasonFor({ code: ECleanupReason.SessionChanged, detail: `${proof.sessionId} -> ${sourceSessionId}` })]
  if (proof.retentionReasons.length > 0 || early.length > 0) {
    return { safe: false, reasons: unique([...proof.retentionReasons, ...early]) }
  }

  const observed = await observeSafely({ cwd: proof.cwd, manifest: proof.manifest })
  const reasons = [...observed.reasons]
  if (!sameList({ left: observed.registryRoots, right: proof.registryRoots })) {
    reasons.push(reasonFor({ code: ECleanupReason.RegistryChanged, detail: observed.registryRoots.join(', ') }))
  }
  if (observed.adminDigest !== proof.adminDigest) {
    reasons.push(reasonFor({ code: ECleanupReason.AdminDrift, detail: proof.cwd }))
  }
  return { safe: reasons.length === 0, reasons: unique(reasons) }
}
