import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'

import { parseWorktreePorcelain, type Worktree } from '../worktrees-parse'
import { captureGit } from './capture-git'
import { absoluteCommonDir } from './git-state'
import { plainReceiptPath, readPlainWorkspaceReceipt } from './plain-receipt'
import { workspaceReceiptSchema, type WorkspaceReceipt, type WorkspaceTree } from './manifest'

export type LayoutTree = Omit<WorkspaceTree, 'fingerprint'> & { excludedRoots: string[] }

export type WorkspaceLayout = {
  repository: { sourcePath: string; originPath: string } | null
  commonDir: string | null
  activeId: string
  activeRelativePath: string
  trees: LayoutTree[]
}

const RECEIPT_NAME = 'atlas-transfer.json'
const MAIN_ID = 'main'
const MAIN_NAME = 'main'

export async function listCapturedWorktrees({ cwd }: { cwd: string }): Promise<readonly Worktree[]> {
  const run = await captureGit({ args: ['worktree', 'list', '--porcelain'], cwd })
  if (!run.ok) throw new Error(`Cannot list worktrees of ${cwd}: ${run.stderr.trim()}`)
  return Promise.all(
    parseWorktreePorcelain({ output: run.stdout }).map(async (worktree) => ({
      ...worktree,
      path: await realpath(worktree.path).catch(() => worktree.path),
    })),
  )
}

const NOT_A_REPOSITORY = /not a git repository/i
const ZERO_HEAD = /^0+$/

const idForPath = (path: string): string =>
  `wt_${createHash('sha256').update(path).digest('hex').slice(0, 12)}`

const readReceipt = async ({ commonDir }: { commonDir: string }): Promise<WorkspaceReceipt | null> => {
  const text = await readFile(join(commonDir, RECEIPT_NAME), 'utf8').catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  })
  if (text === null) return null
  return workspaceReceiptSchema.parse(JSON.parse(text))
}

const isInside = ({ parent, child }: { parent: string; child: string }): boolean =>
  child === parent || child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`)

const activeOf = ({ trees, cwd }: { trees: readonly LayoutTree[]; cwd: string }) => {
  const containing = trees
    .filter((tree) => isInside({ parent: tree.sourcePath, child: cwd }))
    .sort((left, right) => right.sourcePath.length - left.sourcePath.length)[0]
  if (containing === undefined) {
    throw new Error(`${cwd} is not inside any worktree of the repository`)
  }
  const segments = relative(containing.sourcePath, cwd).split(sep).filter((part) => part.length > 0)
  return { activeId: containing.id, activeRelativePath: segments.join('/') }
}

async function plainLayout(cwd: string): Promise<WorkspaceLayout> {
  const receipt = await readPlainWorkspaceReceipt({ path: await plainReceiptPath({ root: cwd }) })
  const id = receipt?.treeId ?? MAIN_ID
  return {
    repository: null,
    commonDir: null,
    activeId: id,
    activeRelativePath: '',
    trees: [
      {
        id,
        name: MAIN_NAME,
        sourcePath: cwd,
        originPath: receipt?.originPath ?? cwd,
        branch: null,
        head: null,
        baseline: receipt?.baseline ?? null,
        isMain: true,
        excludedRoots: [],
      },
    ],
  }
}

export async function discoverLayout({ cwd: requested }: { cwd: string }): Promise<WorkspaceLayout> {
  const cwd = await realpath(requested)
  const top = await captureGit({ args: ['rev-parse', '--show-toplevel'], cwd })
  if (!top.ok && NOT_A_REPOSITORY.test(top.stderr)) return plainLayout(cwd)
  if (!top.ok) throw new Error(`Cannot inspect ${cwd} as a git repository: ${top.stderr.trim()}`)

  const worktrees = await listCapturedWorktrees({ cwd })
  const unusable = worktrees.find((worktree) => worktree.isBare || worktree.isPrunable)
  if (unusable !== undefined) {
    throw new Error(
      `Cannot capture worktree ${unusable.path}: it is ${unusable.isBare ? 'a bare repository' : 'missing on disk (prunable)'}`,
    )
  }

  const commonDir = await realpath(await absoluteCommonDir({ cwd }))
  const receipt = await readReceipt({ commonDir })
  const paths = worktrees.map((worktree) => worktree.path)
  const trees = worktrees.map((worktree): LayoutTree => {
    const known = receipt?.trees.find((entry) => entry.path === worktree.path)
    const head = worktree.head === undefined || ZERO_HEAD.test(worktree.head) ? null : worktree.head
    return {
      id: known?.id ?? (worktree.isMain ? MAIN_ID : idForPath(worktree.path)),
      name: worktree.isMain ? MAIN_NAME : basename(worktree.path),
      sourcePath: worktree.path,
      originPath: known?.originPath ?? worktree.path,
      branch: worktree.branch ?? null,
      head,
      baseline: known?.baseline ?? null,
      isMain: worktree.isMain,
      excludedRoots: paths.filter((path) => path !== worktree.path),
    }
  })
  const main = trees.find((tree) => tree.isMain)
  if (main === undefined) throw new Error(`Cannot find the main worktree of ${cwd}`)
  if (new Set(trees.map((tree) => tree.id)).size !== trees.length) {
    throw new Error(`Transfer receipt in ${commonDir} assigns duplicate tree ids`)
  }

  return {
    repository: { sourcePath: main.sourcePath, originPath: receipt?.repositoryOrigin ?? main.sourcePath },
    commonDir,
    trees,
    ...activeOf({ trees, cwd }),
  }
}
