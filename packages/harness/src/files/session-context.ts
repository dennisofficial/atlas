import type { ThreadId } from '@dltech/atlas-core'

import { atlasDirectory } from '../store/paths'
import { contextDirectory } from '../store/sessions/paths'
import { registryFor } from '../store/sessions/registry'
import { ContextBrowser, type ContextFileContent } from './context-browser'
import { watchContextDirectory, type WatchSeams } from './watch-context-directory'

export type ContextReader = Pick<ContextBrowser, 'list' | 'load'> & {
  subscribe: (listener: () => void, options?: ContextSubscribeOptions) => () => void
  /**
   * The absolute path of a context file on this machine, when the reader is backed by the local
   * filesystem. Undefined for a reader whose files live elsewhere (a cloud sandbox), which is the
   * signal that an editor cannot be pointed at them.
   */
  localPath?: (path: string) => Promise<string | undefined>
}

/** `catchUp` asks for one notification once watching starts, covering changes made before it did. */
export type ContextSubscribeOptions = { catchUp?: boolean | undefined }

export function createSessionContextReader(args: { threadId: ThreadId; home?: string; watchSeams?: WatchSeams }): ContextReader {
  const directory = async () => registryFor({ home: args.home ?? atlasDirectory() })
    .sessionDirFor({ threadId: args.threadId })
  const browser = async () => new ContextBrowser({ root: contextDirectory({ sessionDir: await directory() }) })

  return {
    list: async (path) => (await browser()).list(path),
    load: async (path): Promise<ContextFileContent> => (await browser()).load(path),
    localPath: async (path) => (await (await browser()).resolveFile(path)) ?? undefined,
    subscribe: (listener, options) => {
      let stopped = false
      let close: () => void = () => {}
      void directory().then((root) => {
        if (stopped) return
        close = watchContextDirectory({ sessionDir: root, onChange: listener, catchUp: options?.catchUp, ...args.watchSeams })
        if (stopped) close()
      }, () => { if (!stopped) listener() })
      return () => { stopped = true; close() }
    },
  }
}
