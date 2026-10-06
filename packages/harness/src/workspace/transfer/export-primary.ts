import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'

import { probeWorkspace } from '../probe'
import type { RestoredWorkspace } from './manifest'

const canonical = async (path: string): Promise<string> => {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

const isWithin = ({ root, path }: { root: string; path: string }): boolean => {
  const inside = relative(root, path)
  if (inside === '') return true
  return inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside)
}

const repositoryExportCwd = async ({
  cwd,
  primary,
  repository,
}: {
  cwd: string
  primary: RestoredWorkspace
  repository: string
}): Promise<string> => {
  const [current, saved] = await Promise.all([
    probeWorkspace({ cwd }),
    probeWorkspace({ cwd: repository }),
  ])
  return current.repo !== null && current.repo === saved.repo ? cwd : primary.cwd
}

const plainExportCwd = async ({
  cwd,
  primary,
}: {
  cwd: string
  primary: RestoredWorkspace
}): Promise<string> => {
  const here = await canonical(cwd)
  const roots = await Promise.all(
    [primary.cwd, ...primary.trees.map((tree) => tree.path)].map(canonical),
  )
  if (!roots.some((root) => isWithin({ root, path: here }))) return primary.cwd

  const { repo } = await probeWorkspace({ cwd })
  return repo === null || roots.includes(repo) ? cwd : primary.cwd
}

export async function exportCwdOf({
  cwd,
  primary,
}: {
  cwd: string
  primary: RestoredWorkspace | undefined
}): Promise<string> {
  if (primary === undefined) return cwd
  if (primary.repository === null) return plainExportCwd({ cwd, primary })
  return repositoryExportCwd({ cwd, primary, repository: primary.repository })
}
