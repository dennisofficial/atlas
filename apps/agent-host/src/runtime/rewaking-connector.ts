import {
  SandboxUnavailableError,
  webSocketConnector,
  type DaemonConnector,
} from '@dltech/atlas-host'

import type { DaemonEndpoint } from '../sandbox/sandbox-provider'

const FAILED_CONNECTS_BEFORE_REWAKE = 2

export const rewakingConnector = (args: {
  sessionId: string
  first: Promise<DaemonEndpoint>
  wake(): Promise<DaemonEndpoint>
  signal: AbortSignal
}): (() => Promise<DaemonConnector>) => {
  let endpoint: Promise<DaemonEndpoint> = args.first
  let failedConnects = 0

  const unavailable = (reason: string): SandboxUnavailableError =>
    new SandboxUnavailableError(`sandbox for ${args.sessionId} is unavailable: ${reason}`)

  return async () => {
    if (failedConnects >= FAILED_CONNECTS_BEFORE_REWAKE) {
      if (args.signal.aborted) throw unavailable('the session lifetime ended')
      failedConnects = 0
      endpoint = args.wake()
    }
    let url: string
    try {
      url = (await endpoint).url
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw unavailable(`wake failed: ${reason}`)
    }
    const connect = webSocketConnector({ url })
    return async (handlers) => {
      try {
        const socket = await connect(handlers)
        failedConnects = 0
        return socket
      } catch (error) {
        failedConnects += 1
        throw error
      }
    }
  }
}
