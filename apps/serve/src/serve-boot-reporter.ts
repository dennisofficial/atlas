import {
  EBootStep,
  EBootStepState,
  isApiProvisioned,
  NOOP_BOOT_REPORTER,
  serveBootReporter,
  type BootReporter,
} from '@dltech/atlas-wire'

import { EWorkspaceState, type WorkspaceReadiness } from './materialize-workspace'
import { EServeEvent, type ServeLog } from './serve-log'

export const bootReporterFor = (args: {
  env: Record<string, string | undefined>
  controlPlaneUrl: string
  threadId: string
  token: string
  clientVersion: string
  fetchFn: typeof fetch
  log: ServeLog
}): BootReporter => {
  if (!isApiProvisioned(args.env)) return NOOP_BOOT_REPORTER
  return serveBootReporter({
    controlPlaneUrl: args.controlPlaneUrl,
    threadId: args.threadId,
    token: args.token,
    clientVersion: args.clientVersion,
    fetchFn: args.fetchFn,
    log: (line) => args.log({ event: EServeEvent.BootReportFailed, reason: line }),
  })
}

export const trackClone = async (args: {
  reporter: BootReporter
  work: () => Promise<WorkspaceReadiness>
}): Promise<WorkspaceReadiness> => {
  const { reporter } = args
  await reporter.report({ step: EBootStep.Clone, state: EBootStepState.Running })
  try {
    const readiness = await args.work()
    await reporter.report(
      readiness.state === EWorkspaceState.Failed
        ? { step: EBootStep.Clone, state: EBootStepState.Error, error: readiness.reason }
        : { step: EBootStep.Clone, state: EBootStepState.Done },
    )
    return readiness
  } catch (failure) {
    const error = failure instanceof Error ? failure.message : String(failure)
    await reporter.report({ step: EBootStep.Clone, state: EBootStepState.Error, error })
    throw failure
  }
}
