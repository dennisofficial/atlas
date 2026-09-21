export enum EStationKind {
  Implementer = 'implementer',
  Reviewer = 'reviewer',
}

export enum EReviewVerdict {
  Approve = 'approve',
  RequestChanges = 'request_changes',
}

/** Initial implementation plus this many review-driven revisions; past it the run reports instead. */
export const MAX_REVISION_CYCLES = 2

export enum EStationRunStatus {
  Running = 'running',
  Finished = 'finished',
  Failed = 'failed',
  Stopped = 'stopped',
}

export const FACTORY_BRANCH_PREFIX = 'atlas-factory/'

export const STATION_MESSAGE_CAP = 60_000

export type StationSpawnResult = {
  stationRunId: string
  threadId: string
  status: EStationRunStatus
}

export type StationResultAccepted = {
  recorded: true
  stationRunId: string
}

export type StationGitToken = {
  token: string
  expiresInSeconds: number
}

export type DeliveryResult = {
  delivered: true
  number: number
  url: string
  branch: string
}