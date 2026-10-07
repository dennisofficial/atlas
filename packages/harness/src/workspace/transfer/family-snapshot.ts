import { realpath } from 'node:fs/promises'
import { dirname, relative, sep } from 'node:path'

import { activeWorktreeOf, homeDirectoryOf, type EventLogPort, type ThreadId } from '@dltech/atlas-core'

import { atlasDirectory } from '../../store/paths'
import { sessionDirectory } from '../../store/sessions/paths'
import { SessionRegistry } from '../../store/sessions/registry'
import type { ThreadStorePort } from '../../store/thread-store'
import { ensureFamilyOwnership, presentFamilyCheckouts } from '../family-ownership'
import { captureGit } from './capture-git'
import { listCapturedWorktrees } from './capture-layout'
import type { WorkspaceFamilyCapture } from './manifest'

const missing = (error: unknown): boolean => typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'

export async function captureWorkspaceFamily(args: {
  threadId: ThreadId
  cwd: string
  threads: Pick<ThreadStorePort, 'find' | 'spawned'>
  log: Pick<EventLogPort, 'readOwn'>
  sessionDir?: string | undefined
}): Promise<WorkspaceFamilyCapture | undefined> {
  const cwd = await realpath(args.cwd).catch((error: unknown) => {
    if (missing(error)) return null
    throw error
  })
  if (cwd === null || await args.threads.find({ threadId: args.threadId }) === undefined) return undefined
  const sessionDir = args.sessionDir ?? sessionDirectory({ home: atlasDirectory(), sessionId: args.threadId })
  const registry = new SessionRegistry(dirname(dirname(sessionDir)))
  const ownership = await ensureFamilyOwnership({ sessionDir, registry })
  const checkouts = ownership === null ? [] : await presentFamilyCheckouts({ ownership })
  const primary = ownership?.primaryRepository ?? cwd
  const top = await captureGit({ args: ['rev-parse', '--show-toplevel'], cwd: primary })
  const worktrees = top.ok ? await listCapturedWorktrees({ cwd: primary }) : []
  const main = worktrees.find((tree) => tree.isMain)?.path ?? primary
  const selected = new Set([main, ...checkouts.map((checkout) => checkout.path)])
  const locate = async (requested: string): Promise<string> => {
    const path = await realpath(requested)
    if (!top.ok) {
      const tail = relative(main, path)
      if (tail !== '..' && !tail.startsWith(`..${sep}`) && !tail.startsWith(sep)) return path
      return main
    }
    const actual = await captureGit({ args: ['rev-parse', '--show-toplevel'], cwd: path })
    const checkoutRoot = actual.ok ? await realpath(actual.stdout.trim()) : null
    const registered = worktrees.find((tree) => tree.path === checkoutRoot)
    if (registered === undefined) return main
    if (!selected.has(registered.path)) throw new Error(`family workspace ${path} has no matching owned checkout generation`)
    return path
  }
  const threads: WorkspaceFamilyCapture['threads'] = []
  const family: ThreadId[] = [args.threadId]
  for (const threadId of family) {
    const stored = await args.threads.find({ threadId })
    if (stored === undefined) throw new Error(`family member ${threadId} disappeared before workspace capture`)
    const events = await args.log.readOwn({ threadId })
    const home = await locate(homeDirectoryOf({ events, launchDirectory: stored.workspace ?? cwd }))
    const active = activeWorktreeOf(events)
    const activePath = active === undefined ? undefined : await locate(active.path)
    threads.push({ threadId, home, active: active === undefined || activePath === main && active.path !== main ? null : { ...active, path: activePath ?? active.path } })
    for (const child of await args.threads.spawned({ threadId })) if (!family.includes(child.id)) family.push(child.id)
  }
  return { rootId: args.threadId, checkouts, threads }
}
