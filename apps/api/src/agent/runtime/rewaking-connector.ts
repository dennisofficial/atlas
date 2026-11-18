import {
  SandboxUnavailableError,
  webSocketConnector,
  type DaemonConnector,
} from '@dltech/atlas-host'

import type { DaemonEndpoint } from '../sandbox/sandbox-provider'

const FAILED_CONNECTS_BEFORE_REWAKE = 2
export const REWAKES_BEFORE_GIVING_UP = 3

export const rewakingConnector = (args: {
  sessionId: string
  first: Promise<DaemonEndpoint>
  wake(): Promise<DaemonEndpoint>
  signal: AbortSignal
}): (() => Promise<DaemonConnector>) => {
  let endpoint: Promise<DaemonEndpoint> = args.first
  let failedConnects = 0
  let rewakesWithoutConnect = 0

  const unavailable = (reason: string): SandboxUnavailableError =>
    new SandboxUnavailableError(`sandbox for ${args.sessionId} is unavailable: ${reason}`)

  const nextEndpoint = (): Promise<DaemonEndpoint> => {
    if (failedConnects < FAILED_CONNECTS_BEFORE_REWAKE) return endpoint
    if (args.signal.aborted) throw unavailable('the session lifetime ended')
    if (rewakesWithoutConnect >= REWAKES_BEFORE_GIVING_UP) {
      rewakesWithoutConnect = 0
      throw unavailable(
        `its daemon did not answer after ${REWAKES_BEFORE_GIVING_UP} wakes; the next call wakes it again`,
      )
    }
    failedConnects = 0
    rewakesWithoutConnect += 1
    endpoint = args.wake()
    return endpoint
  }

  return async () => {
    let url: string
    try {
      url = (await nextEndpoint()).url
    } catch (error) {
      if (error instanceof SandboxUnavailableError) throw error
      failedConnects = FAILED_CONNECTS_BEFORE_REWAKE
      const reason = error instanceof Error ? error.message : String(error)
      throw unavailable(`wake failed: ${reason}; the next call wakes it again`)
    }
    const connect = webSocketConnector({ url })
    return async (handlers) => {
      try {
        const socket = await connect(handlers)
        failedConnects = 0
        rewakesWithoutConnect = 0
        return socket
      } catch (error) {
        failedConnects += 1
        throw error
      }
    }
  }
}
