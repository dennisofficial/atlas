import { watch } from 'node:fs'
import { dirname, join } from 'node:path'

import { contextModifiedAt } from './context-modified-at'

// macOS fs.watch drops events for a few milliseconds after the watch is created.
export const ATTACH_RECHECK_DELAY_MS = 50
const CLOCK_SLACK_MS = 50

type Watcher = { on: (event: 'error', listener: () => void) => unknown; close: () => void }
export type WatchPath = (
  path: string,
  options: { recursive: boolean },
  listener: (event: string, name: string | null) => void,
) => Watcher

export function watchContextDirectory(args: {
  sessionDir: string
  onChange: () => void
  changedSince?: number | undefined
  watchPath?: WatchPath | undefined
}): () => void {
  const root = args.sessionDir
  const home = dirname(dirname(root))
  const context = join(root, 'context')
  const watchPath = args.watchPath ?? watch
  let stopped = false
  let close: () => void = () => {}

  const attach = ({ initial }: { initial: boolean }) => {
    if (stopped) return
    close()
    close = () => {}
    for (let ancestor = root; ; ancestor = dirname(ancestor)) {
      const held = ancestor
      let delivered = false
      let watcher: Watcher
      try {
        watcher = watchPath(held, { recursive: held === root }, (_event, name) => {
          if (stopped) return
          const changed = name == null ? held : join(held, name)
          if (changed !== context && !changed.startsWith(`${context}/`) && !context.startsWith(`${changed}/`)) return
          delivered = true
          if (held !== root) attach({ initial: false })
          args.onChange()
        })
      } catch (error) {
        if (ancestor === home || !(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
          args.onChange()
          return
        }
        continue
      }
      watcher.on('error', () => { if (!stopped) args.onChange() })
      const modifiedAtAttach = contextModifiedAt({ context })
      const recheck = setTimeout(() => {
        if (stopped || delivered || contextModifiedAt({ context }) === modifiedAtAttach) return
        if (held !== root) attach({ initial: false })
        args.onChange()
      }, ATTACH_RECHECK_DELAY_MS)
      recheck.unref()
      close = () => { clearTimeout(recheck); watcher.close() }
      if (initial && args.changedSince !== undefined && modifiedAtAttach >= args.changedSince - CLOCK_SLACK_MS) args.onChange()
      return
    }
  }

  attach({ initial: true })
  return () => { stopped = true; close() }
}
