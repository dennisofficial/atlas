import { ContextBrowser } from '@dltech/atlas-harness'
import type { ThreadId } from '@dltech/atlas-core'

import { EServeEvent, type ServeLog } from './serve-log'

export const CONTEXT_MIRROR_MAX_DEPTH = 32

export type MirroredContextTree = {
  textFiles: ReadonlyMap<string, string>
}

export type ScanContextTree = (args: { root: string }) => Promise<MirroredContextTree>

export type PutContextFile = (args: { path: string; content: string }) => Promise<void>
export type DeleteContextFile = (args: { path: string }) => Promise<void>
export type DeleteMissingContextFiles = (args: { keep: readonly string[] }) => Promise<void>

export type ContextFilesFlusher = {
  flush: () => Promise<boolean>
}

const walk = async (args: {
  browser: Pick<ContextBrowser, 'list'>
  directory: string
  depth: number
  into: string[]
}): Promise<void> => {
  if (args.depth > CONTEXT_MIRROR_MAX_DEPTH) return
  const entries = await args.browser.list(args.directory)
  for (const entry of entries) {
    const path = args.directory === '.' ? entry.name : `${args.directory}/${entry.name}`
    if (entry.isDirectory) {
      await walk({ browser: args.browser, directory: path, depth: args.depth + 1, into: args.into })
    } else {
      args.into.push(path)
    }
  }
}

export async function scanContextTree(args: { root: string }): Promise<MirroredContextTree> {
  const browser = new ContextBrowser({ root: args.root })
  const paths: string[] = []
  await walk({ browser, directory: '.', depth: 0, into: paths })
  const textFiles = new Map<string, string>()
  for (const path of paths) {
    const loaded = await browser.load(path)
    if (loaded.type === 'text') textFiles.set(path, loaded.content)
  }
  return { textFiles }
}

export function createContextFilesFlusher(args: {
  threadId: ThreadId
  root: string
  put: PutContextFile
  remove: DeleteContextFile
  deleteMissing: DeleteMissingContextFiles
  scan?: ScanContextTree | undefined
  previous?: ReadonlyMap<string, string> | undefined
  log: ServeLog
}): ContextFilesFlusher {
  const { threadId, log } = args
  const scan = args.scan ?? scanContextTree
  let known = new Map<string, string>(args.previous ?? new Map())
  let synced = args.previous !== undefined
  let chain: Promise<boolean> = Promise.resolve(true)
  let queued: Promise<boolean> | undefined

  const once = async (): Promise<boolean> => {
    try {
      const { textFiles } = await scan({ root: args.root })
      let shipped = 0
      for (const [path, content] of textFiles) {
        if (known.get(path) === content) continue
        await args.put({ path, content })
        shipped += 1
      }
      const stale = [...known.keys()].filter((path) => !textFiles.has(path))
      for (const path of stale) {
        await args.remove({ path })
        shipped += 1
      }
      if (shipped > 0 || !synced) await args.deleteMissing({ keep: [...textFiles.keys()] })
      known = new Map(textFiles)
      synced = true
      return true
    } catch (failure) {
      log({
        event: EServeEvent.ContextMirrorFailed,
        threadId,
        reason: failure instanceof Error ? failure.message : String(failure),
      })
      return false
    }
  }

  const flush = (): Promise<boolean> => {
    if (queued !== undefined) return queued
    const next = chain.then(() => {
      queued = undefined
      return once()
    })
    queued = next
    chain = next
    return next
  }

  return { flush }
}
