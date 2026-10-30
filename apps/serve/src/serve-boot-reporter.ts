import {
  EBootStep,
  EBootStepOutcome,
  EBootStepState,
  isApiProvisioned,
  NOOP_BOOT_REPORTER,
  createBootReporter,
  type BootReporter,
  type BootStepSink,
  type CloneRepoProgress,
} from '@dltech/atlas-wire'

import { controlPlaneError, createApiClient } from './api-client'
import { EWorkspaceState, type WorkspaceReadiness } from './materialize-workspace'
import { EServeEvent, type ServeLog } from './serve-log'

export const serveBootSink = (args: {
  controlPlaneUrl: string
  token: string
  clientVersion: string
  fetchFn: typeof fetch
}): BootStepSink => {
  const client = createApiClient(args)
  return async (events) => {
    await client.sandboxSelf.bootSteps.mutate({ steps: [...events] }).catch((failure: unknown) => {
      throw controlPlaneError(failure)
    })
  }
}

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
  return createBootReporter({
    sink: serveBootSink(args),
    log: (line) => args.log({ event: EServeEvent.BootReportFailed, reason: line }),
  })
}

const CLONE_OUTCOME = {
  [EWorkspaceState.Materialized]: EBootStepOutcome.Cloned,
  [EWorkspaceState.Present]: EBootStepOutcome.Reused,
  [EWorkspaceState.Skipped]: EBootStepOutcome.NoRepository,
} as const

export const trackClone = async (args: {
  reporter: BootReporter
  work: (progress: (repos: CloneRepoProgress[]) => void) => Promise<WorkspaceReadiness>
}): Promise<WorkspaceReadiness> => {
  const { reporter } = args
  await reporter.report({
    step: EBootStep.Clone,
    state: EBootStepState.Running,
  })
  try {
    const readiness = await args.work((repos) => {
      void reporter.report({
        step: EBootStep.Clone,
        state: EBootStepState.Running,
        repos,
      })
    })
    const repos = readiness.state === EWorkspaceState.Materialized ? readiness.repos : undefined
    await reporter.report(
      readiness.state === EWorkspaceState.Failed
        ? {
            step: EBootStep.Clone,
            state: EBootStepState.Error,
            error: readiness.reason,
            ...(readiness.repos === undefined ? {} : { repos: readiness.repos }),
          }
        : {
            step: EBootStep.Clone,
            state: EBootStepState.Done,
            outcome: CLONE_OUTCOME[readiness.state],
            ...(repos === undefined ? {} : { repos }),
          },
    )
    return readiness
  } catch (failure) {
    const error = failure instanceof Error ? failure.message : String(failure)
    await reporter.report({
      step: EBootStep.Clone,
      state: EBootStepState.Error,
      error,
    })
    await reporter.flush()
    throw failure
  }
}

export const strictBootSinkFor = (args: {
  env: Record<string, string | undefined>
  controlPlaneUrl: string
  token: string
  clientVersion: string
  fetchFn: typeof fetch
}): BootStepSink | undefined => (isApiProvisioned(args.env) ? serveBootSink(args) : undefined)

export const trackAgentStep = async <T>(args: {
  reporter: BootReporter
  strictSink: BootStepSink | undefined
  work: () => Promise<T>
}): Promise<T> => {
  const { reporter, strictSink } = args
  if (strictSink === undefined) return reporter.track({ step: EBootStep.Agent, work: args.work })
  try {
    await reporter.flush()
    await strictSink([{ step: EBootStep.Agent, state: EBootStepState.Running }])
  } catch (failure) {
    const error = failure instanceof Error ? failure.message : String(failure)
    await reporter.report({
      step: EBootStep.Agent,
      state: EBootStepState.Error,
      error,
    })
    await reporter.flush()
    throw failure
  }
  try {
    const result = await args.work()
    await reporter.report({
      step: EBootStep.Agent,
      state: EBootStepState.Done,
    })
    return result
  } catch (failure) {
    const error = failure instanceof Error ? failure.message : String(failure)
    await reporter.report({
      step: EBootStep.Agent,
      state: EBootStepState.Error,
      error,
    })
    await reporter.flush()
    throw failure
  }
}
