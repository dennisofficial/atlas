import type { ToolOutcome, ToolSpanDetail } from '@dltech/atlas-core'

export enum EServiceFailure {
  InvalidArgs = 'invalid-args',
  NotDeclared = 'not-declared',
  InvalidDeclaration = 'invalid-declaration',
  SetupFailed = 'setup-failed',
  LaunchFailed = 'launch-failed',
  StopFailed = 'stop-failed',
  DaemonRejected = 'daemon-rejected',
}

export type ServiceFailed = { ok: false; reason: string; failure: EServiceFailure }

export const serviceFailed = (args: {
  reason: string
  failure: EServiceFailure
}): ServiceFailed => ({ ok: false, reason: args.reason, failure: args.failure })

export const failureSpanDetail = (failure: EServiceFailure): ToolSpanDetail => ({
  'service.failure': failure,
})

export const failureOutcome = (failed: ServiceFailed): ToolOutcome => ({
  ok: false,
  reason: failed.reason,
  spanDetail: failureSpanDetail(failed.failure),
})
