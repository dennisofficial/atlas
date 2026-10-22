import { existsSync, watch } from 'node:fs'
import { dirname, join } from 'node:path'

import { scanContextSignature, type ContextSignature } from './context-signature'

// macOS fs.watch drops events for a few milliseconds after the watch is created.
export const ATTACH_RECHECK_DELAY_MS = 50

type Watcher = { on: (event: 'error', listener: () => void) => unknown; close: () => void }
export type WatchPath = (
  path: string,
  options: { recursive: boolean },
  listener: (event: string, name: string | null) => void,
) => Watcher
export type Schedule = (args: { run: () => Promise<void>; delayMs: number }) => () => void
export type ScanContext = (args: { context: string }) => Promise<ContextSignature>
export type WatchSeams = {
  watchPath?: WatchPath | undefined
  schedule?: Schedule | undefined
  scanContext?: ScanContext | undefined
}

const scheduleTimeout: Schedule = ({ run, delayMs }) => {
  const timer = setTimeout(() => {
    void run()
  }, delayMs)
  timer.unref()
  return () => clearTimeout(timer)
}

export function watchContextDirectory(
  args: { sessionDir: string; onChange: () => void; catchUp?: boolean | undefined } & WatchSeams,
): () => void {
  const root = args.sessionDir
  const home = dirname(dirname(root))
  const context = join(root, 'context')
  const watchPath = args.watchPath ?? watch
  const schedule = args.schedule ?? scheduleTimeout
  const scanContext = args.scanContext ?? scanContextSignature
  let stopped = false
  let close: () => void = () => {}
  const recheckReattachedTo = new Set<string>()

  const nearestExistingAncestor = () => {
    let ancestor = root
    while (ancestor !== home && !existsSync(ancestor)) ancestor = dirname(ancestor)
    return ancestor
  }

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
          if (
            changed !== context &&
            !changed.startsWith(`${context}/`) &&
            !context.startsWith(`${changed}/`)
          )
            return
          delivered = true
          if (held !== root) attach({ initial: false })
          args.onChange()
        })
      } catch (error) {
        if (
          ancestor === home ||
          !(error instanceof Error) ||
          !('code' in error) ||
          error.code !== 'ENOENT'
        ) {
          args.onChange()
          return
        }
        continue
      }
      watcher.on('error', () => {
        if (stopped) return
        delivered = true
        args.onChange()
      })
      const atAttach = scanContext({ context })
      const cancelRecheck = schedule({
        run: async () => {
          const before = await atAttach
          if (stopped || delivered) return
          const after = await scanContext({ context })
          if (stopped || delivered) return
          const nearest = nearestExistingAncestor()
          if (nearest !== held && !recheckReattachedTo.has(nearest)) {
            recheckReattachedTo.add(nearest)
            attach({ initial: false })
          }
          if (!before.capped && !after.capped && before.signature === after.signature) return
          args.onChange()
        },
        delayMs: ATTACH_RECHECK_DELAY_MS,
      })
      close = () => {
        cancelRecheck()
        watcher.close()
      }
      if (initial && args.catchUp === true)
        queueMicrotask(() => {
          if (!stopped) args.onChange()
        })
      return
    }
  }

  attach({ initial: true })
  return () => {
    stopped = true
    close()
  }
}
