import { watch } from 'node:fs'
import { dirname, join } from 'node:path'

export function watchContextDirectory(args: {
  sessionDir: string
  onChange: () => void
}): () => void {
  const root = args.sessionDir
  const home = dirname(dirname(root))
  const context = join(root, 'context')
  let stopped = false
  let close: () => void = () => {}

  const attach = () => {
    if (stopped) return
    close()
    close = () => {}
    for (let ancestor = root; ; ancestor = dirname(ancestor)) {
      try {
        const held = ancestor
        const watcher = watch(held, { recursive: held === root }, (_event, name) => {
          if (stopped) return
          const changed = name == null ? held : join(held, name)
          if (changed !== context && !changed.startsWith(`${context}/`) && !context.startsWith(`${changed}/`)) return
          if (held !== root) attach()
          args.onChange()
        })
        watcher.on('error', () => { if (!stopped) args.onChange() })
        close = () => watcher.close()
        return
      } catch (error) {
        if (ancestor === home || !(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
          args.onChange()
          return
        }
      }
    }
  }

  attach()
  return () => { stopped = true; close() }
}
