import { randomUUID } from 'node:crypto'
import { readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { runGit } from './run-git'
import { listWorktrees, type Worktree } from './worktrees'

export const CHECKOUT_MARKER_NAME = 'atlas-checkout-id'

const NOT_A_REPOSITORY = 'not a git repository'

const MISSING_CODES: ReadonlySet<unknown> = new Set(['ENOENT', 'ENOTDIR'])
const MARKER_SETTLE_ATTEMPTS = 20
const MARKER_SETTLE_MS = 10

const codeOf = (error: unknown): unknown =>
  typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined

const isMissing = (error: unknown): boolean => MISSING_CODES.has(codeOf(error))

export async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (error) {
    if (isMissing(error)) return path
    throw error
  }
}

export async function toplevelOf({ path }: { path: string }): Promise<string | null> {
  if (!(await pathExists({ path }))) return null
  const run = await runGit({ args: ['rev-parse', '--show-toplevel'], cwd: path })
  if (run.ok) return canonicalPath(run.stdout.trim())
  if (run.stderr.toLowerCase().includes(NOT_A_REPOSITORY)) return null
  throw new Error(`could not resolve the checkout containing ${path}: ${run.stderr.trim()}`)
}

export async function pathExists({ path }: { path: string }): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

export enum ELinkedCheckouts {
  Repository = 'repository',
  NotARepository = 'not-a-repository',
}

export type LinkedCheckouts =
  | { readonly kind: ELinkedCheckouts.Repository; readonly linked: ReadonlyMap<string, Worktree> }
  | { readonly kind: ELinkedCheckouts.NotARepository }

export async function linkedCheckoutsOf({ primary }: { primary: string }): Promise<LinkedCheckouts> {
  const listing = await listWorktrees({ cwd: primary })
  if (!listing.ok) {
    if (listing.message.toLowerCase().includes(NOT_A_REPOSITORY)) return { kind: ELinkedCheckouts.NotARepository }
    throw new Error(`could not list the checkouts of ${primary}: ${listing.message}`)
  }
  const linked = new Map<string, Worktree>()
  for (const worktree of listing.worktrees) {
    if (worktree.isMain || worktree.isBare) continue
    linked.set(worktree.path, worktree)
  }
  return { kind: ELinkedCheckouts.Repository, linked }
}

export async function registeredPrimaryOf({ checkout }: { checkout: string }): Promise<string | null> {
  const listing = await listWorktrees({ cwd: checkout })
  if (!listing.ok) {
    if (listing.message.toLowerCase().includes(NOT_A_REPOSITORY)) return null
    throw new Error(`could not read the registered checkouts around ${checkout}: ${listing.message}`)
  }
  return listing.worktrees.find((worktree) => worktree.isMain)?.path ?? null
}

async function markerFile({ checkout }: { checkout: string }): Promise<string> {
  const run = await runGit({ args: ['rev-parse', '--path-format=absolute', '--git-dir'], cwd: checkout })
  const gitDir = run.stdout.trim()
  if (!run.ok || gitDir.length === 0) throw new Error(`could not inspect the git administration of ${checkout}: ${run.stderr.trim()}`)
  return join(gitDir, CHECKOUT_MARKER_NAME)
}

export async function readCheckoutMarker({ checkout }: { checkout: string }): Promise<string | null> {
  const file = await markerFile({ checkout })
  try {
    const text = await readFile(file, 'utf8')
    return text.length === 0 ? null : text
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function settledMarker({ checkout }: { checkout: string }): Promise<string> {
  for (let attempt = 0; attempt < MARKER_SETTLE_ATTEMPTS; attempt += 1) {
    const marker = await readCheckoutMarker({ checkout })
    if (marker !== null) return marker
    await pause(MARKER_SETTLE_MS)
  }
  throw new Error(`the checkout generation marker of ${checkout} exists but stayed empty`)
}

export async function claimCheckoutMarker({ checkout }: { checkout: string }): Promise<string> {
  const existing = await readCheckoutMarker({ checkout })
  if (existing !== null) return existing
  const id = randomUUID()
  try {
    await writeFile(await markerFile({ checkout }), id, { flag: 'wx' })
    return id
  } catch (error) {
    if (codeOf(error) !== 'EEXIST') throw error
    return settledMarker({ checkout })
  }
}
