import { realpath } from 'node:fs/promises'

import { digestGitAdmin } from './capture-admin'
import { snapshotWorkspaceTree } from './capture-fingerprint'
import { listCapturedWorktrees } from './capture-layout'
import type { WorkspaceManifest, WorkspaceTree } from './manifest'

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

type CoveredRoot = { tree: WorkspaceTree; root: string }

export const reasonFor = ({ code, detail }: { code: ECleanupReason; detail: string }): string => `${code}: ${detail}`

export const describeFailure = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const duplicates = (values: readonly string[]): string[] =>
  [...new Set(values.filter((value, index) => values.indexOf(value) !== index))]

async function resolveCovered({
  manifest,
  reasons,
}: {
  manifest: WorkspaceManifest
  reasons: string[]
}): Promise<CoveredRoot[]> {
  const resolved = await Promise.all(
    manifest.trees.map(async (tree) => {
      try {
        return { tree, root: await realpath(tree.sourcePath) }
      } catch (error) {
        reasons.push(
          reasonFor({ code: ECleanupReason.InspectionFailed, detail: `covered root ${tree.sourcePath}: ${describeFailure(error)}` }),
        )
        return null
      }
    }),
  )
  const covered = resolved.filter((entry): entry is CoveredRoot => entry !== null)
  for (const root of duplicates(covered.map((entry) => entry.root))) {
    reasons.push(reasonFor({ code: ECleanupReason.AmbiguousRoot, detail: root }))
  }
  return covered
}

async function listRegistry({ cwd, reasons }: { cwd: string; reasons: string[] }): Promise<string[]> {
  try {
    const worktrees = await listCapturedWorktrees({ cwd })
    for (const worktree of worktrees) {
      if (!worktree.isBare && !worktree.isPrunable) continue
      reasons.push(reasonFor({ code: ECleanupReason.UnusableCheckout, detail: worktree.path }))
    }
    const roots = worktrees.map((worktree) => worktree.path)
    for (const root of duplicates(roots)) reasons.push(reasonFor({ code: ECleanupReason.AmbiguousRoot, detail: root }))
    return [...new Set(roots)].sort()
  } catch (error) {
    reasons.push(reasonFor({ code: ECleanupReason.InspectionFailed, detail: `registry of ${cwd}: ${describeFailure(error)}` }))
    return []
  }
}

async function checkFingerprints({ covered, reasons }: { covered: readonly CoveredRoot[]; reasons: string[] }): Promise<void> {
  await Promise.all(
    covered.map(async ({ tree, root }) => {
      try {
        const snapshot = await snapshotWorkspaceTree({ cwd: root })
        if (snapshot.fingerprint !== tree.fingerprint) {
          reasons.push(reasonFor({ code: ECleanupReason.FingerprintDrift, detail: root }))
        }
      } catch (error) {
        reasons.push(reasonFor({ code: ECleanupReason.InspectionFailed, detail: `tree ${root}: ${describeFailure(error)}` }))
      }
    }),
  )
}

async function digestAdmin({ covered, reasons }: { covered: readonly CoveredRoot[]; reasons: string[] }): Promise<string | null> {
  try {
    return await digestGitAdmin({ trees: covered.map(({ tree, root }) => ({ sourcePath: root, branch: tree.branch })) })
  } catch (error) {
    reasons.push(reasonFor({ code: ECleanupReason.InspectionFailed, detail: `administration: ${describeFailure(error)}` }))
    return null
  }
}

export async function observeSource({
  cwd,
  manifest,
}: {
  cwd: string
  manifest: WorkspaceManifest
}): Promise<SourceObservation> {
  const reasons: string[] = []
  const root = await realpath(cwd).catch(() => null)
  if (root === null) {
    reasons.push(reasonFor({ code: ECleanupReason.InspectionFailed, detail: `source ${cwd} cannot be resolved` }))
    return { cwd, registryRoots: [], adminDigest: null, reasons }
  }
  const covered = await resolveCovered({ manifest, reasons })
  await checkFingerprints({ covered, reasons })
  if (manifest.repository === null) return { cwd: root, registryRoots: [], adminDigest: null, reasons }

  const registryRoots = await listRegistry({ cwd: root, reasons })
  const coveredRoots = new Set(covered.map((entry) => entry.root))
  const registered = new Set(registryRoots)
  for (const path of registryRoots.filter((path) => !coveredRoots.has(path))) {
    reasons.push(reasonFor({ code: ECleanupReason.UnrelatedCheckout, detail: path }))
  }
  for (const path of coveredRoots) {
    if (!registered.has(path)) reasons.push(reasonFor({ code: ECleanupReason.UnregisteredRoot, detail: path }))
  }
  const adminDigest = await digestAdmin({ covered, reasons })
  return { cwd: root, registryRoots, adminDigest, reasons }
}
