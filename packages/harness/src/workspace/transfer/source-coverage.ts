import { realpath } from 'node:fs/promises'

import { discoverLayout, listCapturedWorktrees } from './capture-layout'
import type { WorkspaceManifest } from './manifest'

export type SourceCoverageChecker = (args: { cwd: string; manifest?: WorkspaceManifest | undefined }) => Promise<void>

const canonical = (path: string): Promise<string> => realpath(path)

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error))

async function coveredRoots({
  cwd,
  manifest,
}: {
  cwd: string
  manifest: WorkspaceManifest | undefined
}): Promise<readonly string[] | null> {
  if (manifest === undefined) {
    const layout = await discoverLayout({ cwd })
    if (layout.repository === null) return null
    return layout.trees.map((tree) => tree.sourcePath)
  }
  if (manifest.repository === null) return null
  return Promise.all(manifest.trees.map((tree) => canonical(tree.sourcePath)))
}

async function omittedRoots({
  cwd,
  manifest,
}: {
  cwd: string
  manifest: WorkspaceManifest | undefined
}): Promise<readonly string[]> {
  const covered = await coveredRoots({ cwd, manifest })
  if (covered === null) return []
  const exact = new Set(covered)
  const registered = await listCapturedWorktrees({ cwd: await canonical(cwd) })
  return registered.map((worktree) => worktree.path).filter((path) => !exact.has(path))
}

export const requireCoveredSourceWorktrees: SourceCoverageChecker = async ({ cwd, manifest }) => {
  const omitted = await omittedRoots({ cwd, manifest }).catch((error: unknown) => {
    throw new Error(
      `Cannot confirm that every checkout of the repository at ${cwd} is covered by the workspace archive (${reason(error)}). The source stays in the cloud session and nothing was removed.`,
    )
  })
  if (omitted.length === 0) return
  throw new Error(
    `The workspace archive covers only the main worktree and the active worktree, but the repository also has registered checkouts it would not carry:\n${omitted.map((path) => `  ${path}`).join('\n')}\nThe source stays in the cloud session and no work was removed. Preserve those omitted checkouts separately before retrying; this handoff does not transfer or remove them.`,
  )
}
