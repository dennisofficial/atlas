import { POD_NAME_ENV, sandboxNameFor, VercelDriver } from '@dltech/atlas-harness'
import { isApiProvisioned, SANDBOX_SELF_STOP_PATH } from '@dltech/atlas-wire'
import type { ThreadId } from '@dltech/atlas-core'

import { postSandboxSelf } from './sandbox-self-client'

export type SignalSender = (args: { pid: number; signal: NodeJS.Signals }) => void

const POD_INIT_PID = 1

const killProcess: SignalSender = ({ pid, signal }) => {
  process.kill(pid, signal)
}

export const missingProviderStop = (): Promise<void> =>
  Promise.reject(new Error('this runtime has no sandbox to stop'))

export function sandboxPark(args: {
  threadId: ThreadId
  controlPlaneUrl: string
  env: Record<string, string | undefined>
  token: string
  clientVersion?: string | undefined
  fetchFn?: typeof fetch | undefined
}): (() => Promise<void>) | undefined {
  if (isApiProvisioned(args.env)) {
    const sessionId = args.env.ATLAS_SANDBOX_SESSION_ID
    return async () => {
      await postSandboxSelf({
        controlPlaneUrl: args.controlPlaneUrl,
        path: SANDBOX_SELF_STOP_PATH,
        token: args.token,
        clientVersion: args.clientVersion ?? 'dev',
        fetchFn: args.fetchFn ?? fetch,
        body: sessionId ? { sessionId } : {},
      })
    }
  }
  const token = args.env.VERCEL_TOKEN
  const teamId = args.env.VERCEL_TEAM_ID
  const projectId = args.env.VERCEL_PROJECT_ID
  const sessionId = args.env.ATLAS_SANDBOX_SESSION_ID
  if (!token || !teamId || !projectId || !sessionId) return undefined

  const driver = new VercelDriver({
    credentials: { token, teamId, projectId },
    cloudUrl: args.controlPlaneUrl,
  })
  return () => driver.stop({ name: sandboxNameFor({ threadId: args.threadId }), sessionId })
}

export function podPark(args: {
  env: Record<string, string | undefined>
  sendSignal?: SignalSender | undefined
}): (() => Promise<void>) | undefined {
  if (!args.env[POD_NAME_ENV]) return undefined

  const sendSignal = args.sendSignal ?? killProcess
  return async () => {
    sendSignal({ pid: POD_INIT_PID, signal: 'SIGTERM' })
  }
}

export function providerStopFor(args: {
  threadId: ThreadId
  controlPlaneUrl: string
  env: Record<string, string | undefined>
  token: string
  clientVersion?: string | undefined
  fetchFn?: typeof fetch | undefined
  sendSignal?: SignalSender
  sandboxStopFor?: typeof sandboxPark
}): () => Promise<void> {
  const sandboxStopFor = args.sandboxStopFor ?? sandboxPark
  return (
    sandboxStopFor({
      threadId: args.threadId,
      controlPlaneUrl: args.controlPlaneUrl,
      env: args.env,
      token: args.token,
      clientVersion: args.clientVersion,
      fetchFn: args.fetchFn,
    }) ??
    podPark({ env: args.env, sendSignal: args.sendSignal }) ??
    missingProviderStop
  )
}
