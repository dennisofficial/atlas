export enum EStationKind {
  Implementer = 'implementer',
}

export enum EStationRunStatus {
  Running = 'running',
  Finished = 'finished',
  Failed = 'failed',
  Stopped = 'stopped',
}

export const FACTORY_BRANCH_PREFIX = 'atlas-factory/'

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
