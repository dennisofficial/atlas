import type { SessionApi } from './session-api'
import { startLoopbackReturn, type LoopbackCopy } from '@dltech/atlas-client/loopback'

import { createBrowserReturnOpener, type BrowserReturnOpener } from './browser-return/open'

export type GithubConnectApi = Pick<
  SessionApi,
  | 'githubState'
  | 'beginGithubConnect'
  | 'beginGithubRedirect'
  | 'pollGithubConnect'
  | 'disconnectGithub'
>

export const GITHUB_RETURN_COPY: LoopbackCopy = {
  connected: 'GitHub connected. Return to Atlas.',
  failed: (reason) => reason ?? 'GitHub did not connect.',
}

export const createGithubBrowserReturn = (args: {
  generation: { current: number }
  fallback: { current: () => void }
}): BrowserReturnOpener =>
  createBrowserReturnOpener({
    start: (request) => {
      const id = args.generation.current
      const listener = startLoopbackReturn(request)
      void listener.outcome.then((returned) => {
        if (returned === undefined && args.generation.current === id) args.fallback.current()
      })
      return listener
    },
  })
