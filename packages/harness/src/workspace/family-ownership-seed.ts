import { readFile, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { EWorktreeExit, toThreadId } from '@dltech/atlas-core'

import { readMetaSync, sessionMetaSchema, threadMetaSchema, type ThreadMeta } from '../store/sessions/meta'
import { THREAD_META_FILE_SUFFIX, sessionMetaFile, threadsDirectory } from '../store/sessions/paths'
import type { SessionRegistry } from '../store/sessions/registry'
import { canonicalPath, claimCheckoutMarker, linkedCheckoutsOf, pathExists, toplevelOf } from './family-ownership-git'
import { readFamilyOwnership, writeFamilyOwnership, type FamilyCheckout, type FamilyOwnership } from './family-ownership-file'

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'

async function readThreadMeta({ file }: { file: string }): Promise<ThreadMeta | undefined> {
  try {
    return threadMetaSchema.parse(JSON.parse(await readFile(file, 'utf8')))
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
}

async function namesIn({ directory }: { directory: string }): Promise<string[]> {
  try {
    return await readdir(directory)
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
}

async function readThreadMetas({ sessionDir }: { sessionDir: string }): Promise<ThreadMeta[]> {
  const directory = threadsDirectory({ sessionDir })
  const names = await namesIn({ directory })
  const metas = await Promise.all(
    names.filter((name) => name.endsWith(THREAD_META_FILE_SUFFIX)).map((name) => readThreadMeta({ file: join(directory, name) })),
  )
  return metas
    .filter((meta): meta is ThreadMeta => meta !== undefined)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
}

async function claimsOfThread({ registry, sessionDir, meta }: { registry: SessionRegistry; sessionDir: string; meta: ThreadMeta }): Promise<string[]> {
  const held = new Set<string>()
  const adopt = async (path: string): Promise<void> => {
    const checkout = await toplevelOf({ path })
    if (checkout !== null) held.add(checkout)
  }
  if (meta.workspace !== null) await adopt(meta.workspace)
  if (meta.parentThreadId !== null) return [...held]
  const log = await registry.readThreadLog({ sessionDir, threadId: toThreadId(meta.id) })
  for (const event of log.events) {
    if (event.type === 'worktree-entered') held.add(await canonicalPath(event.path))
    if (event.type === 'directory-changed') await adopt(event.path)
    if (event.type !== 'worktree-exited') continue
    const path = await canonicalPath(event.path)
    if (event.action === EWorktreeExit.Remove) held.delete(path)
    else held.add(path)
  }
  return [...held]
}

async function candidatesOf({ registry, sessionDir }: { registry: SessionRegistry; sessionDir: string }): Promise<Map<string, string>> {
  const candidates = new Map<string, string>()
  for (const meta of await readThreadMetas({ sessionDir })) {
    for (const path of await claimsOfThread({ registry, sessionDir, meta })) {
      if (!candidates.has(path)) candidates.set(path, meta.id)
    }
  }
  return candidates
}

export async function ensureFamilyOwnership({
  sessionDir,
  registry,
}: {
  sessionDir: string
  registry: SessionRegistry
}): Promise<FamilyOwnership | null> {
  const existing = await readFamilyOwnership({ sessionDir })
  if (existing !== null) return existing

  const session = readMetaSync({ file: sessionMetaFile({ sessionDir }), schema: sessionMetaSchema })
  if (session?.repo === null || session?.repo === undefined) return null
  const primary = await canonicalPath(session.repo)
  if (!(await pathExists({ path: primary }))) return null
  const registered = await linkedCheckoutsOf({ primary })
  if (registered.kind === 'not-a-repository') return null

  const checkouts: FamilyCheckout[] = []
  for (const [path, claimedBy] of await candidatesOf({ registry, sessionDir })) {
    const worktree = registered.linked.get(path)
    if (worktree === undefined || worktree.isPrunable || !(await pathExists({ path }))) continue
    checkouts.push({ id: await claimCheckoutMarker({ checkout: path }), path, claimedBy })
  }
  const ownership: FamilyOwnership = { version: 1, rootId: session.id || basename(sessionDir), primaryRepository: primary, checkouts }
  await writeFamilyOwnership({ sessionDir, ownership })
  return ownership
}
