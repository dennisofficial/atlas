import {
  capturedAdminBaseline,
  cleanupDriftReasons,
  describeFailure,
  ECleanupReason,
  reasonFor,
  sessionRetentionReasons,
  uniqueReasons,
  type SourceObservation,
} from '@dltech/atlas-core'

import { observeSource } from './cleanup-proof-inspect'
import type { WorkspaceManifest } from './manifest'

export { ECleanupReason } from '@dltech/atlas-core'

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
  const baseline = capturedAdminBaseline({
    hasRepository: manifest.repository !== null,
    captured: manifest.administrationFingerprint,
    observedDigest: observed.adminDigest,
  })
  return {
    generation,
    sessionId: sourceSessionId,
    manifest,
    cwd: observed.cwd,
    registryRoots: [...observed.registryRoots],
    adminDigest: baseline.digest,
    retentionReasons: uniqueReasons([...observed.reasons, ...baseline.reasons]),
  }
}

export async function verifySourceCleanupProof({
  proof,
  sourceSessionId,
}: {
  proof: SourceCleanupProof
  sourceSessionId: string
}): Promise<SourceCleanupVerdict> {
  const early = sessionRetentionReasons({ proofSessionId: proof.sessionId, sourceSessionId })
  if (proof.retentionReasons.length > 0 || early.length > 0) {
    return { safe: false, reasons: uniqueReasons([...proof.retentionReasons, ...early]) }
  }

  const observed = await observeSafely({ cwd: proof.cwd, manifest: proof.manifest })
  const reasons = cleanupDriftReasons({ observed, proof })
  return { safe: reasons.length === 0, reasons: uniqueReasons(reasons) }
}
