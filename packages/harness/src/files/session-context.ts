import type { ThreadId } from '@dltech/atlas-core'

import { atlasDirectory } from '../store/paths'
import { contextDirectory } from '../store/sessions/paths'
import { registryFor } from '../store/sessions/registry'
import { ContextBrowser, type ContextFileContent } from './context-browser'
import { watchContextDirectory } from './watch-context-directory'

export type ContextReader = Pick<ContextBrowser, 'list' | 'load'> & {
  subscribe: (listener: () => void) => () => void
}

export function createSessionContextReader(args: { threadId: ThreadId; home?: string }): ContextReader {
  const directory = async () => registryFor({ home: args.home ?? atlasDirectory() })
    .sessionDirFor({ threadId: args.threadId })
  const browser = async () => new ContextBrowser({ root: contextDirectory({ sessionDir: await directory() }) })

  return {
    list: async (path) => (await browser()).list(path),
    load: async (path): Promise<ContextFileContent> => (await browser()).load(path),
    subscribe: (listener) => {
      let stopped = false
      let close: () => void = () => {}
      void directory().then((root) => {
        if (stopped) return
        close = watchContextDirectory({ sessionDir: root, onChange: listener })
      }, () => { if (!stopped) listener() })
      return () => { stopped = true; close() }
    },
  }
}
