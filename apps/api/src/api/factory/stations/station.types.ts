export enum EStationKind {
  Implementer = 'implementer',
  Reviewer = 'reviewer',
}

export const parseStationKind = (value: string): EStationKind | undefined =>
  value === EStationKind.Implementer
    ? EStationKind.Implementer
    : value === EStationKind.Reviewer
      ? EStationKind.Reviewer
      : undefined

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