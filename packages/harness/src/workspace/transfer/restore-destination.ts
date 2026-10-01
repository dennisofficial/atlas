import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

import { parseWorktreeLockToken } from '@dltech/atlas-core'

import { holderIsLive, ownIdentity } from '../process-identity'
import { listWorktrees } from '../worktrees'
import type { Worktree } from '../worktrees-parse'
import { fingerprintWorkspaceTree } from './capture-fingerprint'
import { z } from 'zod'

import { workspaceReceiptSchema, type WorkspaceManifest, type WorkspaceTree } from './manifest'
import { exists, isEmptyDirectory } from './restore-files'
import { git } from './restore-git'
import { EWorkspaceRestoreMode, ETreeAction, type DestinationPlan, type PlannedTree } from './restore-types'

export const RECEIPT_NAME = 'atlas-transfer.json'
const WORKTREES_DIR = join('.atlas', 'worktrees')
const SUFFIX_ATTEMPTS = 50

export const defaultSuffix = (): string => randomBytes(2).toString('hex')

export const safeName = (name: string): string => {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '')
  return cleaned.length === 0 ? 'tree' : cleaned
}

const isUnder = ({ parent, child }: { parent: string; child: string }): string | null => {
  const tail = relative(parent, child)
  if (tail === '' || tail === '..' || tail.startsWith(`..${sep}`) || tail.startsWith(sep)) return null
  return tail
}

const restoredReceiptSchema = workspaceReceiptSchema.extend({
  trees: z.array(workspaceReceiptSchema.shape.trees.element.extend({ generation: z.string().optional() })),
})

export type RestoredReceipt = z.infer<typeof restoredReceiptSchema>

export async function readReceipt({ commonDir }: { commonDir: string }): Promise<RestoredReceipt | null> {
  const text = await readFile(join(commonDir, RECEIPT_NAME), 'utf8').catch(() => null)
  if (text === null) return null
  const parsed = restoredReceiptSchema.safeParse(JSON.parse(text))
  return parsed.success ? parsed.data : null
}

async function freeSuffixed({ make, build, taken }: { make: () => string; build: (suffix: string) => string; taken: Set<string> }) {
  for (let attempt = 0; attempt < SUFFIX_ATTEMPTS; attempt += 1) {
    const suffix = make()
    const path = build(suffix)
    if (!taken.has(path) && !(await exists(path))) {
      taken.add(path)
      return { suffix, path }
    }
  }
  throw new Error('could not find an unused suffix for the restored workspace')
}

export class DestinationMovedError extends Error {
  constructor(path: string, readonly changed: readonly string[] = []) {
    super(`${path} changed while the restore was being prepared${changed.length === 0 ? '' : `: ${changed.slice(0, 5).join(', ')}`}`)
    this.name = 'DestinationMovedError'
  }
}

export async function assertStillReplaceable({ path, tree, repoCwd }: { path: string; tree: WorkspaceTree; repoCwd: string }): Promise<void> {
  if (!(await replaceable({ path, tree }))) throw new DestinationMovedError(path)
  const listing = await listWorktrees({ cwd: repoCwd })
  const found = listing.ok ? listing.worktrees.find((worktree) => worktree.path === path) : undefined
  if (await heldByAnother(found)) throw new DestinationMovedError(path)
}

async function heldByAnother(worktree: Worktree | undefined): Promise<boolean> {
  if (worktree === undefined || !worktree.isLocked) return false
  const holder = parseWorktreeLockToken(worktree.lockedReason ?? '')
  if (holder === undefined) return true
  const ours = await ownIdentity()
  if (holder.pid === ours.pid && holder.start === ours.start) return false
  return holderIsLive(holder)
}

const cloudPath = ({ anchor, tree, used }: { anchor: string; tree: WorkspaceTree; used: Set<string> }): string => {
  if (tree.isMain) return anchor
  let name = safeName(tree.name)
  if (used.has(name)) name = `${name}-${tree.id}`
  used.add(name)
  return join(anchor, WORKTREES_DIR, name)
}

const hostPath = ({ manifest, target, tree, used, registered = [] }: { manifest: WorkspaceManifest; target: string; tree: WorkspaceTree; used: Set<string>; registered?: readonly string[] }): string => {
  if (tree.isMain) return target
  const inside = manifest.repository === null ? null : isUnder({ parent: manifest.repository.originPath, child: tree.originPath })
  if (inside !== null) return join(target, inside)
  if (registered.includes(tree.originPath)) return tree.originPath
  return cloudPath({ anchor: target, tree, used })
}

async function planPlain({ manifest, target, mode, make }: { manifest: WorkspaceManifest; target: string; mode: EWorkspaceRestoreMode; make: () => string }): Promise<DestinationPlan> {
  const tree = manifest.trees[0]
  if (tree === undefined) throw new Error('archive manifest has no trees')
  const free = !(await exists(target)) || (await isEmptyDirectory(target))
  const same = !free && mode === EWorkspaceRestoreMode.Host && await replaceable({ path: target, tree })
  if (free || same) {
    return { anchor: target, fresh: false, repoCwd: target, registered: [], trees: [{ tree, path: target, action: free ? ETreeAction.Create : ETreeAction.InPlace, suffix: null }] }
  }
  const alternate = await freeSuffixed({ make, build: (suffix) => `${target}-${suffix}`, taken: new Set() })
  return { anchor: alternate.path, fresh: false, repoCwd: alternate.path, registered: [], trees: [{ tree, path: alternate.path, action: ETreeAction.Create, suffix: alternate.suffix }] }
}

async function replaceable({ path, tree }: { path: string; tree: WorkspaceTree }): Promise<boolean> {
  const current = await fingerprintWorkspaceTree({ cwd: path }).catch(() => null)
  return current !== null && (current === tree.baseline || current === tree.fingerprint)
}

async function reusable({ receipt, tree, registered }: { receipt: RestoredReceipt | null; tree: WorkspaceTree; registered: readonly string[] }): Promise<string | null> {
  const candidates = (receipt?.trees ?? []).filter((entry) => entry.generation === tree.fingerprint && registered.includes(entry.path))
  for (const entry of candidates) {
    if ((await fingerprintWorkspaceTree({ cwd: entry.path }).catch(() => null)) === entry.baseline) return entry.path
  }
  return null
}

async function hostRepository({ target }: { target: string }): Promise<{ commonDir: string; worktrees: readonly Worktree[] } | null> {
  if (!(await exists(join(target, '.git')))) return null
  const common = await git({ args: ['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd: target })
  const listing = await listWorktrees({ cwd: target })
  if (!common.ok || !listing.ok) return null
  return { commonDir: common.stdout.trim(), worktrees: listing.worktrees }
}

export async function planDestination({
  manifest,
  target,
  mode,
  suffix,
}: {
  manifest: WorkspaceManifest
  target: string
  mode: EWorkspaceRestoreMode
  suffix: () => string
}): Promise<DestinationPlan> {
  if (manifest.repository === null) return planPlain({ manifest, target, mode, make: suffix })
  const existing = mode === EWorkspaceRestoreMode.Host ? await hostRepository({ target }) : null
  const used = new Set<string>()
  const taken = new Set<string>()
  if (existing === null) {
    const free = !(await exists(target)) || (await isEmptyDirectory(target))
    const anchor = free ? target : (await freeSuffixed({ make: suffix, build: (made) => `${target}-${made}`, taken })).path
    const place = mode === EWorkspaceRestoreMode.Host ? hostPath : (placing: Parameters<typeof hostPath>[0]) => cloudPath({ anchor: placing.target, tree: placing.tree, used: placing.used })
    const trees = manifest.trees.map((tree): PlannedTree => ({
      tree,
      path: place({ manifest, target: anchor, tree, used }),
      action: ETreeAction.Create,
      suffix: null,
    }))
    return { anchor, fresh: true, repoCwd: anchor, registered: [], trees }
  }

  const receipt = await readReceipt({ commonDir: existing.commonDir })
  const registered = existing.worktrees.map((worktree) => worktree.path)
  const trees: PlannedTree[] = []
  for (const tree of manifest.trees) {
    const wanted = hostPath({ manifest, target, tree, used, registered })
    const found = existing.worktrees.find((worktree) => worktree.path === wanted)
    if (found === undefined && !(await exists(wanted))) {
      taken.add(wanted)
      trees.push({ tree, path: wanted, action: ETreeAction.Create, suffix: null })
      continue
    }
    if (found !== undefined && !(await heldByAnother(found)) && (await replaceable({ path: wanted, tree }))) {
      trees.push({ tree, path: wanted, action: ETreeAction.InPlace, suffix: null })
      continue
    }
    const earlier = await reusable({ receipt, tree, registered })
    if (earlier !== null) {
      trees.push({ tree, path: earlier, action: ETreeAction.Reuse, suffix: null })
      continue
    }
    const base = tree.isMain ? 'main' : safeName(tree.name)
    const made = await freeSuffixed({ make: suffix, build: (value) => join(target, WORKTREES_DIR, `${base}-${value}`), taken })
    trees.push({ tree, path: made.path, action: ETreeAction.Create, suffix: made.suffix })
  }
  return { anchor: target, fresh: false, repoCwd: target, registered, trees }
}
