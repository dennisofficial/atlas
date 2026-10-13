import { watch, type FSWatcher } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { isSyncableName, type WatchTarget } from './layout'

export type UserLayerWatchHandle = {
  refresh: () => Promise<void>
  close: () => void
}

const DEBOUNCE_MS = 500

const subdirectoriesOf = async (directory: string): Promise<readonly string[]> => {
  try {
    const entries = await readdir(directory, { recursive: true, withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(entry.parentPath, entry.name))
  } catch {
    return []
  }
}

export function watchUserLayer(args: {
  targets: () => Promise<readonly WatchTarget[]>
  onChange: () => void
  debounceMs?: number | undefined
}): UserLayerWatchHandle {
  const debounceMs = args.debounceMs ?? DEBOUNCE_MS
  const watchers = new Map<string, FSWatcher>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let recursiveSupported = true
  let closed = false

  const fire = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      args.onChange()
    }, debounceMs)
  }

  const open = (opened: { directory: string; recursive: boolean; accept?: WatchTarget['accept'] }): void => {
    const key = `${opened.recursive ? 'r' : 'd'}:${opened.directory}`
    if (watchers.has(key)) return
    const watcher = watch(opened.directory, { recursive: opened.recursive }, (_event, filename) => {
      const name = filename === null ? null : basename(filename.toString())
      if (name !== null && !isSyncableName(name)) return
      if (name !== null && opened.accept !== undefined && !opened.accept(name)) return
      fire()
    })
    watcher.unref()
    watcher.on('error', () => undefined)
    watchers.set(key, watcher)
  }

  const openRecursively = async (directory: string): Promise<void> => {
    if (recursiveSupported) {
      try {
        open({ directory, recursive: true })
        return
      } catch {
        recursiveSupported = false
      }
    }
    for (const nested of [directory, ...(await subdirectoriesOf(directory))]) {
      try {
        open({ directory: nested, recursive: false })
      } catch {
        continue
      }
    }
  }

  const refresh = async (): Promise<void> => {
    for (const target of await args.targets()) {
      if (closed) return
      try {
        if (target.recursive) await openRecursively(target.directory)
        else open(target)
      } catch {
        continue
      }
    }
  }

  return {
    refresh,
    close: () => {
      closed = true
      if (timer !== null) clearTimeout(timer)
      timer = null
      for (const watcher of watchers.values()) watcher.close()
      watchers.clear()
    },
  }
}
