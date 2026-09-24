import { watch, type FSWatcher } from 'node:fs'
import { dirname } from 'node:path'

export type SettingsWatchHandle = {
  close: () => void
}

const DEBOUNCE_MS = 100

/**
 * Watches the directories holding the settings files rather than the files themselves, because a
 * settings file need not exist at boot — the first write creates it, and only a directory watch
 * sees that. Both stores write via rename, so the event fires on the directory either way.
 */
export function watchSettingsFiles(args: {
  files: readonly string[]
  onChange: () => void
  debounceMs?: number
}): SettingsWatchHandle {
  const debounceMs = args.debounceMs ?? DEBOUNCE_MS
  const watchers: FSWatcher[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  const fire = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      args.onChange()
    }, debounceMs)
  }

  for (const directory of new Set(args.files.map((file) => dirname(file)))) {
    try {
      const watcher = watch(directory, fire)
      watcher.unref()
      watcher.on('error', () => undefined)
      watchers.push(watcher)
    } catch {
      // A directory that cannot be watched leaves that layer static for the process's life.
    }
  }

  return {
    close: () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
      for (const watcher of watchers) watcher.close()
    },
  }
}
