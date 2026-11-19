import { EWorkspaceStep, EWorkspaceStepState } from '@dltech/atlas-core'
import { RemoteCalls, type HostTimers } from '@dltech/atlas-host'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import type { DaemonEndpoint, SandboxProvider, SandboxTarget } from '../sandbox/sandbox-provider'
import type { PrepareSteps } from './prepare-steps'
import { rewakingConnector } from './rewaking-connector'

export type DaemonSession = {
  calls: RemoteCalls
  endpoint: Promise<DaemonEndpoint>
  wake(): Promise<DaemonEndpoint>
}

export const daemonSessionOf = (args: {
  sessionId: string
  epoch: number
  provider: SandboxProvider
  target: SandboxTarget
  daemonSecret: string
  timers: HostTimers
  signal: AbortSignal
  steps: PrepareSteps
  log?: LogPort | undefined
  pingMs?: number | undefined
}): DaemonSession => {
  let current: DaemonEndpoint | undefined
  const wake = async (): Promise<DaemonEndpoint> => {
    const endpoint = await args.provider.wake({ target: args.target, signal: args.signal })
    current = endpoint
    return endpoint
  }
  args.steps.report({ step: EWorkspaceStep.Sandbox, state: EWorkspaceStepState.Started })
  const endpoint = wake()
  endpoint.then(
    () => args.steps.report({ step: EWorkspaceStep.Sandbox, state: EWorkspaceStepState.Done }),
    (error: unknown) => args.steps.failOpen(error instanceof Error ? error.message : String(error)),
  )
  endpoint.catch((error: unknown) => {
    args.log?.error({
      source: 'runtime.wake',
      message: `sandbox wake for ${args.sessionId} rejected`,
      ...logFieldsOf({ error }),
    })
  })
  const calls = new RemoteCalls({
    sessionId: args.sessionId,
    token: () => current?.token ?? '',
    connector: rewakingConnector({
      sessionId: args.sessionId,
      first: endpoint,
      wake,
      signal: args.signal,
    }),
    timers: args.timers,
    onFenced: () => {},
    ...(args.pingMs === undefined ? {} : { pingMs: args.pingMs }),
    ...(args.log === undefined ? {} : { log: args.log }),
  })
  calls.open({ epoch: args.epoch })
  return { calls, endpoint, wake }
}
